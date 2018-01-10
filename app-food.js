var superagent = require('superagent');
var charset = require('superagent-charset');
charset(superagent);
var cheerio = require('cheerio');
var express = require('express');
var app = express();
var https = require('https');
var request = require('request'); 
var fs = require('fs');
var multer  = require('multer');
var upload = multer({ dest: 'uploads/' });
var OSS = require('ali-oss');
var co = require('co');
var client = new OSS({
    region: 'oss-cn-hangzhou',
    accessKeyId: 'LTAIrUHBoHLwlUNY',
    accessKeySecret: 'OvuJdzBuziDOIQFRD4gbZXI1fDQ8qC',
    bucket: 'breakfastcover'
});
// 引入json解析中间件
var bodyParser = require('body-parser');
// 添加json解析
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: false}));

var MongoClient = require('mongodb').MongoClient;
var ObjectID = require('mongodb').ObjectID;
var DB_CONN_STR = 'mongodb://localhost:27017/food'; 

const successCode = 0, failCode = -1;

function isEmpty(obj){
    for (var i in obj){
        return false;
    }
    return true;
}
function trim(str){  
  return str.replace(/^(\s|\u00A0)+/,'').replace(/(\s|\u00A0)+$/,'');  
}

/**
 * [breakfast] 健康知食
 * @type {Object}
 */
var foodWXInfo = {
        appid: 'wx885d081a14cc5ba0',
        secret: 'aadcee9ccf0a05625951f31a824783e4'
    };
app.get('/', function(req, res){
    res.send('<h1>时刻有约</h1>');
});

app.get('/fdopenid', function(req, res){
    var code = req.query.code;
    res.header("Content-Type", "application/json; charset=utf-8");

    superagent.get('https://api.weixin.qq.com/sns/jscode2session?appid='+foodWXInfo.appid+'&secret='+foodWXInfo.secret+'&js_code='+code+'&grant_type=authorization_code')
    .charset('utf-8')
    .end(function (err, sres) {
        if (err) {
            res.json({code: failCode, msg: err});
            return;
        }
        var openId = JSON.parse(sres.text).openid;
        res.json({code: successCode, msg: "", data: openId});        
    });

});

app.get('/fdaccesstoken', function(req, res){
    var code = req.query.code;
    res.header("Content-Type", "application/json; charset=utf-8");
       
    MongoClient.connect(DB_CONN_STR, function(err, db) {
        var collection = db.collection('wx');
        var requestNewToken = function(){
            superagent.get('https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid'+foodWXInfo.appid+'&secret='+foodWXInfo.secret)
            .charset('utf-8')
            .end(function (err, sres) {
                if (err) {
                    res.json({code: failCode, msg: err});
                    return;
                }
                var dataJson = JSON.parse(sres.text),
                    access_token = dataJson.access_token,
                    expires_in = dataJson.expires_in;
                collection.update({name:'token'},{$set:{
                    access_token: access_token,
                    expires_time: Date.now() + expires_in*1000
                }}, function(err, result) { 
                    res.json({code: successCode, msg: "", data: access_token});  
                    db.close();
                });
                      
            });
        };
        collection.find({name:'token'}).toArray(function(err, items){ 
            if(items.length>0) {
                var now = Date.now();
                if(now < items[0].expires_time) {
                    res.json({code: successCode, msg: "", data: items[0].access_token}); 
                    db.close();
                } else {
                    requestNewToken();
                }
            } else {
                requestNewToken();
            }
        });
    });
});
app.get('/fdqrcode', function(req, res){
    var accessToken = req.query.accessToken,
        scene = req.query.scene,
        id = scene.split('=')[1],
        path = req.query.path,
        width = Number(req.query.width);
    res.header("Content-Type", "application/json; charset=utf-8");
    var filePath = './uploads/qrcode/'+id+'.png';
    request({ 
        method: 'POST', 
        url: 'https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=' + accessToken, 
        body: JSON.stringify({scene:scene,path:path,width:width}) 
    }).pipe(fs.createWriteStream(filePath))
    .on('close', function() {
        co(function* () {
            var stream = fs.createReadStream(filePath);
            var result = yield client.putStream(id+'.png', stream);
            res.json({code: successCode, msg: "", data: result.url.replace(/http:/,'https:')});
            fs.unlinkSync(filePath);
        });
    });
});

app.get('/addfduser', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");
    var userInfo = {
        open_id: req.query.openId,
        nick_name: req.query.nickName,
        gender: Number(req.query.gender),
        language: req.query.language,
        city: req.query.city,
        province: req.query.province,
        country: req.query.country,
        avatar_url: req.query.avatarUrl
    };
    MongoClient.connect(DB_CONN_STR, function(err, db) {
        console.log("adduser连接成功！");
        //执行插入数据操作
        var collection = db.collection('user');
        collection.find({open_id: userInfo.open_id}).toArray(function(err, items){        
            if(items.length>0) {
                res.json({code: 1, msg: "", data: items[0]});

                //关闭数据库
                db.close();
            } else {

                //插入数据
                collection.insert(userInfo, function(error, result) { 
                    res.json({code: successCode, msg: "", data: result}); 
                    db.close();
                });
            }
        });
    });
});

app.get('/findfduser', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");
    var userId = req.query.id;
    MongoClient.connect(DB_CONN_STR, function(err, db) {
        console.log("findbfuser连接成功！");
        var collection = db.collection('user');
        var collection_meal = db.collection('meal');
        collection.findOne({_id: ObjectID(userId)}, function(err1, item){  
            if(err1) {
                res.json({code: failCode, data: err1}); 
                db.close();
                return;
            }
        });
    });
});

app.get('/getnews2', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");

    MongoClient.connect(DB_CONN_STR, function(err, db) { 
        var collection = db.collection('news');
        collection.insertMany([{
            title: '喝汤比吃肉更容易长胖！',
            summary: '喝汤比吃肉更加容易胖？很多人在减肥期间都是肉一点都不碰，而炖汤一天两三罐，其实，喝汤有时候比吃肉还容易胖。为什么呢?一起看看这是为什么吧！',
            cover: {
                cover_img: 'https://foodcover.oss-cn-hangzhou.aliyuncs.com/20667576729.jpg',
                cover_width: '475',
                cover_height: '300'
            },
            tag: '饮食常识',
            source: 'mstx',
            rich_content: [
                {
                    "type" : "title",
                    "content" : "为什么这么说?"
                },
                {
                    "type" : "text",
                    "content" : "在炖汤的过程中，脂肪很容易就融入到汤中，因此汤里面就含有很多的嘌呤、脂肪以及热量。汤中含有的脂肪成分可以高达20%，多喝汤就会变成了摄入更多的动物性脂肪。"
                },
                {
                    "type" : "text",
                    "content" : "且更多数的人跟小编一样都是只喝汤不吃肉的。在炖汤的过程中最多只能溶出10%的蛋白质和其他营养物质到汤里，也就是说，大部分的营养都还是在肉里面的。如果你只喝汤不吃肉，那就相当于把脂肪喝进去，把蛋白质丢掉了。"
                },
                {
                    "type" : "title",
                    "content" : "煲汤的时间越长越好吗?"
                },
                {
                    "type" : "text",
                    "content" : "随着生活水平的提高，各种煲汤设备也是琳琅满目。就比如人们经常用来煲汤的隔水炖，动不动就是要3~4小时的。其实煲汤的时间过长并不会让汤里面的营养有所增高。不仅如此煲汤的时间越长食物里面的氨基酸遭到破坏就会越严重，蛋白质含量也越低，相比之下，营养反而降低了。不仅如此，肉类的食物炖的时间太长了，也很容易就产生些亚硝酸等有害物质。时间最好控制在一个半小时"
                }

            ],
            create_time: Date.now()-72*3600*1000
        },{
            title: '怀孕吃这些，宝宝更聪明',
            summary: '怀孕期间宝妈在饮食上有很多需要注意的地方，那孕妈怎么吃，吃什么能让宝宝更聪明呢？平时在饮食上多吃一些有利于宝宝变聪明的食物，那么当宝宝出生以后真的能让宝宝变得更聪明吗？',
            cover: {
                cover_img: 'https://foodcover.oss-cn-hangzhou.aliyuncs.com/289aerjeuiIUh.jpg',
                cover_width: '800',
                cover_height: '532'
            },
            tag: '母婴饮食',
            source: 'mstx',
            rich_content: [
                {
                    "type" : "title",
                    "content" : "1、多吃豆制品"
                },
                {
                    "type" : "text",
                    "content" : "豆制品中亚油酸、亚麻酸、油酸等多不饱和脂肪酸含量都相当多，是很好的健脑食品。另外豆制品的蛋白质含量丰富，如果与奶制品交替食用，对促进宝宝智力发育将有更加有效的作用。常见的豆制品有四豆浆、豆腐脑、豆浆等。"
                },
                {
                    "type" : "title",
                    "content" : "2、多吃蔬菜"
                },
                {
                    "type" : "text",
                    "content" : "蔬菜类的食物中含有不少的营养，包括钙质、维生素A、维生素C以及胡萝卜素等等营养物质，而这些营养物质都是帮助宝宝的皮肤增强抗损伤能力以及帮助宝宝的皮肤生长得更有弹性的很有必要的物质，所以孕期可以多吃一些蔬菜类的食物，尤其是西兰花、胡萝卜等。"
                },
                {
                    "type" : "title",
                    "content" : "3、多吃坚果"
                },
                {
                    "type" : "text",
                    "content" : "坚果类食物也是补脑佳品。特别是核桃，含有丰富的营养素，据测验，核桃仁有5倍于鸡蛋，十倍于牛奶的营养价值，特别是对大脑神经细胞有益的钙、铁、和维生素B1、维生素B2等成分含量比较高。此外还有花生、榛子、栗子、瓜子等，对于胎儿大脑的发育都有明显的促进作用。"
                },
                {
                    "type" : "title",
                    "content" : "4、多吃鱼类"
                },
                {
                    "type" : "text",
                    "content" : "类多含不饱和脂肪酸，有助于代谢，还不易发胖长肉，对身体健康有好处。此外，孕妇常吃鱼类，有助于胎儿摄入DHA，有利大脑发育，还可使眼睛明亮又漂亮。"
                },
                {
                    "type" : "title",
                    "content" : "5、多吃水果"
                },
                {
                    "type" : "text",
                    "content" : "水果中不仅富含各种维生素和矿物质元素，维生素C、铁等，这些营养物质对于胎儿智力的发育都有很明显的作用。怀孕可以食用水果有：香蕉、苹果、葡萄、石榴等。"
                },
                {
                    "type" : "text",
                    "content" : "总而言之，孕妇保持营养均衡，多吃水果蔬菜、坚果，少吃点辛辣油炸的食物，不要吃麻辣食品，适当的走路散步，保持心情，有助于生的宝宝更加健康，更加聪明。"
                }

            ],
            create_time: Date.now()-71*3600*1000
        },{
            title: '5种养胃食物，告别胃病不再见',
            summary: '冬天养胃不是矫情，而是每个人都必须做好的一件事，如果你的胃除了问题，你不仅享受不了美食，生活还要备受煎熬，其实养胃也不是一件难事。今天小编要为大家推荐五种对养胃有奇效的食物，希望大家可以在这个冬天里多多食用，告别胃病的困扰。',
            cover: {
                cover_img: 'https://foodcover.oss-cn-hangzhou.aliyuncs.com/2eef987d37553dd9b772d19698e76d32.jpg',
                cover_width: '500',
                cover_height: '330'
            },
            tag: '食疗食补',
            source: 'mstx',
            rich_content: [
                {
                    "type" : "title",
                    "content" : "冬天吃什么养胃"
                },
                {
                    "type" : "title",
                    "content" : "一、甘蓝 功效是天然的养胃菜"
                },
                {
                    "type" : "text",
                    "content" : "甘蓝入胃、肾二经。甘蓝是世界卫生组织曾推荐的最佳蔬菜之一，也被誉为天然养胃菜。其性平味甘，无毒，所含的维生素K1及维生素U，不仅能抗胃部溃疡、保护并修复胃黏膜组织，还可以保持胃部细胞活跃旺盛，降低病变的几率。患胃溃疡及十二指肠溃疡的人，还可以每天以奘灵水苏糖饮用，奘灵水苏糖作为水溶性纤维素，可保护胃黏膜和吸收胃酸，减轻溃疡性疼痛，长期食用，有促进溃疡愈合的作用。"
                },
                {
                    "type" : "title",
                    "content" : "二、菠菜 功效是可以补血利便"
                },
                {
                    "type" : "text",
                    "content" : "菠菜能润燥养肝，益肠胃，通便秘。《食疗本草》载：利五脏，通肠胃，解酒毒。菠菜可促进胃和胰腺分泌，增食欲，味甘性凉，助消化;丰富的纤维素还能帮助肠道蠕动，有利排便。不过，菠菜草酸含量高，妨碍钙质吸收，应避免与豆腐、紫菜等高钙食物同吃，或在烹煮前轻氽，除去草酸。"
                },
                {
                    "type" : "title",
                    "content" : "三、红薯 功效是可以养胃去积"
                },
                {
                    "type" : "text",
                    "content" : "《纲目拾遗》记：补中，暖胃，肥五脏。天寒食用，正气养胃，化食去积，兼可清肠减肥。很多人认为吃完红薯放屁多，红薯里面有糖，会不会引起胃酸过多了，其实是胃肠蠕动所致。不过，红薯内淀粉含量很高，吃完后会转为葡萄糖，不适合糖尿病患者食用。糖尿病人其实可以服用奘灵水苏糖来养胃护肠，红薯性平，味甘，补脾益气。"
                },
                {
                    "type" : "title",
                    "content" : "四、胡萝卜 功效是可以增强抵抗力"
                },
                {
                    "type" : "text",
                    "content" : "胡萝卜，中国医学认为它下气补中，利脾膈，润肠胃，安五脏，有健食之效。丰富的胡萝卜素可转化成维生素A，性味甘平能明目养神，增强抵抗力，防治呼吸道疾病。胡萝卜素属脂溶性，和肉一起炖最合适，味道也更好。"
                },
                {
                    "type" : "title",
                    "content" : "五、南瓜 功效是可以排毒护胃"
                },
                {
                    "type" : "text",
                    "content" : "《本草纲目》载：南瓜性温，味甘，入脾，胃经，能补中益气、消炎杀菌、止痛。其所含的丰富果胶，可吸附细菌和有毒物质，包括重金属，铅等，起到排毒作用。同时，果胶可保护胃部免受刺激，减少溃疡。可用南瓜煮粥或汤，滋养肠胃。"
                },
                {
                    "type" : "title",
                    "content" : "伤胃坏习惯"
                },
                {
                    "type" : "text",
                    "content" : "1、晚餐过饱"
                },
                {
                    "type" : "text",
                    "content" : "2、过度劳累"
                },
                {
                    "type" : "text",
                    "content" : "3、烟酒过度"
                },
                {
                    "type" : "text",
                    "content" : "4、睡前进食"
                }

            ],
            create_time: Date.now()-48*3600*1000
        },{
            title: '怎么吃燕麦才能减肥？',
            summary: '减肥最重要的是运动和控制饮食，在控制饮食方面，很多人为了达到减肥的目的，不吃饭，但是如果长期不吃对身体有害处，因此部分人会选择减肥代餐，或者吃一些热量低的食物。那么天天吃燕麦真的可以减肥吗?',
            cover: {
                cover_img: 'https://foodcover.oss-cn-hangzhou.aliyuncs.com/20161215125.jpg',
                cover_width: '726',
                cover_height: '480'
            },
            tag: '瘦身饮食',
            source: 'mstx',
            rich_content: [
                {
                    "type" : "title",
                    "content" : "燕麦有什么好处"
                },{
                    "type" : "text",
                    "content" : "其实除了减肥人士，普通人经常吃适量的燕麦对身体也有很多好处。北京宣武医院营养科李缨副主任医师在此前家庭医生在线的相关采访中曾表示从营养成分来分析，燕麦蛋白质中的必需氨基酸组成与每人每日摄取量的标准相差极小，且组成全面。其含有18种氨基酸中，有8种是人体必需的氨基酸，且配比合理、利用率高，因而其蛋白质营养价值甚至可与鸡蛋相媲美。不仅如此，燕麦中的脂肪也是相当健康的，属于优质植物脂肪。尤其是所含的亚油酸，不仅能用来维持人体正常的新陈代谢，而且还是合成前列腺素的必要成分。"
                },{
                    "type" : "title",
                    "content" : "燕麦为什么可以减肥"
                },{
                    "type" : "text",
                    "content" : "燕麦能作为一种减肥食品，是因为燕麦中含有可溶性膳食纤维，包括果胶、树胶等膳食纤维，这些纤维可以抑制食物中脂肪和胆固醇的吸收，促进胆汁的排泄，促进肠道蠕动。这样就使得小肠对脂肪和糖类的吸收减少，防止人体摄入过多的热量，让身体内的脂肪消耗增加，从而起到减肥作用。所以天天吃燕麦有助于减肥，但是也不能为了减肥只吃燕麦，因为营养均衡，合理的饮食，以及配合适量的运动才能更加容易达到减肥的效果。"
                },{
                    "type" : "title",
                    "content" : "燕麦还可预防癌症和心脑血管疾病"
                },{
                    "type" : "text",
                    "content" : "最重要的是燕麦中含有的纤维，可使致癌物质浓度相对降低，减少了致癌物质与的肠壁接触时间，达到预防肠癌的目的。同时这种燕麦含有的果胶，进入人体内就会和胆固醇结合，然后让其随着粪便排出。因此，常喝燕麦可以降低胆固醇，降低血脂，而高血脂又是心脑血管疾病的罪魁祸首，控制了血脂，就能更好保护血管，从而预防心脑血管疾病。"
                },{
                    "type" : "text",
                    "content": "每天适当地摄取燕麦这类粗粮是很有必要的，但也一定要注意粗细搭配。而且燕麦作为粗粮，吃得太多，就会影响消化，还可能导致肠道阻塞、脱水等急性症状。因此胃肠功能较差的人群，比如老年人，部分肠胃病患者还有肠胃功能不健全的婴幼儿，都不宜一次吃过多燕麦，而且即使吃也尽量熬粥后再进食。"
                }
            ],
            create_time: Date.now()-47*3600*1000
        },{
            title: '加班熬夜伤身体 教你补救方法',
            summary: '加班熬夜是经常有的事，熬夜不仅对皮肤有伤害，给身体也带来了更大的伤害，那么如果经常熬夜的话，该怎么补救呢？下面就来了解下吧。加班熬夜教你3个补救方法',
            cover: {
                cover_img: 'https://foodcover.oss-cn-hangzhou.aliyuncs.com/2017022270407153.jpg',
                cover_width: '605',
                cover_height: '375'
            },
            tag: '食疗食补',
            source: 'mstx',
            rich_content: [
                {
                    "type" : "title",
                    "content" : "1、清晨最关键"
                },{
                    "type" : "text",
                    "content" : "没睡多少个小时就要起床，也许你头痛欲裂，这时一定要以冷水洗脸，另外用冰片或喝剩的茶叶包敷眼周，可有效打消眼部浮肿，淡化黑眼圈。大口呼吸新鲜空气，让脑筋灵敏。做一些简单易行的肌肉放松动作，可以舒缓筋骨，抵达减压效果。早餐能够稍稍侧重富含蛋白质的食物，如豆浆、沙丁鱼等，能够给大脑补充足够的营养。"
                },{
                    "type" : "title",
                    "content" : "2、晚餐有考究"
                },{
                    "type" : "text",
                    "content" : "皮肤在得不到充足睡眠的情况下，会出现水分和营养的过度散失，因此晚餐应多补充一些含维生素C或含有胶原蛋白的食物，利于皮肤还原弹性和光泽。大量的水果中都富含维生素C，或者口服1～2片维生素C片。忌食辛辣食物和酒精类饮料，最好不要抽烟。"
                },{
                    "type" : "title",
                    "content" : "3、睡前需护理"
                },{
                    "type" : "text",
                    "content" : "熬夜过后倒头就睡是最不好的习惯，这时应先喝一杯加少许蜜糖的洋甘菊茶，既能润燥又有助于睡眠。在彻底清洁皮肤后，喷上一层保湿喷雾，再涂上浓度较低的天然果酸霜。缺乏睡眠的皮肤必需要以保湿为上，果酸霜不只能够去死皮，还能令肌肤复原光泽，成效显著。"
                },{
                    "type" : "title",
                    "content" : "这些药茶可以缓解熬夜带来的伤害"
                },{
                    "type" : "text",
                    "content" : "1、红枣姜茶"
                },{
                    "type" : "text",
                    "content" : "2、百合枣仁茶"
                },{
                    "type" : "text",
                    "content" : "3、菊花蜜汁"
                },{
                    "type" : "text",
                    "content" : "4、玫瑰薄荷茶"
                },{
                    "type" : "text",
                    "content" : "5、柠檬枸杞茶"
                },
            ],
            create_time: Date.now()-24*3600*1000
        },{
            title: '冬天吃雪糕，到底合不合适？',
            summary: '一提到夏天，大家都会想到雪糕，但在寒冷的冬天，一些人也会吃雪糕过瘾。那么，冬天到底适不适合吃雪糕呢？',
            cover: {
                cover_img: 'https://foodcover.oss-cn-hangzhou.aliyuncs.com/1ns7000426rq4ro8n95p.jpg',
                cover_width: '640',
                cover_height: '426'
            },
            tag: '饮食常识',
            source: 'mstx',
            rich_content: [
                {
                    "type" : "title",
                    "content" : "1、冬天什么时候吃雪糕"
                },{
                    "type" : "text",
                    "content" : "冬天的时候并不适任何时候都适合吃雪糕，在寒冷的环境中，吃雪糕那纯粹是自虐行为。冬天适合吃雪糕的时机是室内开着暖气或空调的时候，这个时候环境燥热，人很容易出现烦躁的情绪，这个时候适当的吃一些冰凉清热的食物，例如雪糕，就能很好的缓解调理燥热情况。"
                },{
                    "type" : "title",
                    "content" : "2、冬天吃雪糕注意事项"
                },{
                    "type" : "text",
                    "content" : "冬天室内温度较高的时候虽然吃雪糕有好处，但是也有要注意的事项，错误的吃法也会对健康带来不利的影响。很多人吃了雪糕之后，感觉燥热消退，就感觉全身舒爽，因此，不少人会选择再吃一根，这种做法吃错误的，这样会导致体内代谢环境温度过低，从而对健康带来非常不利的影响。"
                },{
                    "type" : "title",
                    "content" : "3、吃雪糕太多的危害"
                },{
                    "type" : "text",
                    "content" : "冬天的时候就算能吃雪糕，也只能适当食用不能吃的太多，吃的太多冰凉的雪糕会对肠胃造成较大的刺激，从而导致肠胃功能异常，很容易出现消化不良、腹泻等不适病症，因此冬天不能吃太多的雪糕。在寒冷的环境中，也不能吃太多的雪糕，否则会引起身体体温过低，从而引起不适。"
                }
            ],
            create_time: Date.now()-23*3600*1000
        },{
            title: '吃火锅容易上火？降火食物准备好',
            summary: '冬季这种大冷天，很多人都喜欢吃火锅，但是火锅又是很容易上火的东西，那么吃火锅上火的情况下，该吃什么食物来降火呢？',
            cover: {
                cover_img: 'https://foodcover.oss-cn-hangzhou.aliyuncs.com/20160518163129_22188.jpg',
                cover_width: '803',
                cover_height: '632'
            },
            tag: '饮食常识',
            source: 'mstx',
            rich_content: [
                {
                    "type" : "title",
                    "content" : "冬天吃火锅上火了怎么降火？喝杯果蔬汁"
                },{
                    "type" : "title",
                    "content" : "黄瓜汁"
                },{
                    "type" : "text",
                    "content" : "两根黄瓜，加适量纯净水打成浆，滤渣留汁水，喝下后上火情况可以很快缓解。"
                },{
                    "type" : "title",
                    "content" : "梨汁"
                },{
                    "type" : "text",
                    "content" : "梨是很好的清热降火的食物，尤其是吃完火锅以后马上吃个梨，或是喝杯梨子汁，可以有效预防上火，若已经上火的人，吃些梨可以缓解嗓子干疼等不适。"
                },{
                    "type" : "title",
                    "content" : "西红柿汁"
                },{
                    "type" : "text",
                    "content" : "丰富的维生素，可谓是“维生素宝库”，尤其是含有大量的维生素c，番茄素等等，可以降火排毒，保养皮肤。"
                },{
                    "type" : "title",
                    "content" : "海带豆芽汤"
                },{
                    "type" : "text",
                    "content" : "以海带、黄豆芽、胡萝卜、番茄熬汤。补充维生素，清热去火，促进排毒。"
                },{
                    "type" : "title",
                    "content" : "吃火锅不上火窍门"
                },{
                    "type" : "title",
                    "content" : "配一杯凉茶喝"
                },{
                    "type" : "text",
                    "content" : "吃火锅的时候，可以搭配一杯凉茶喝，或是搭配一杯蔬菜汁，绿茶等等，有利于滋阴降火，健胃消食，解油解腻，既能防上火，又可以促进消化。"
                },{
                    "type" : "title",
                    "content" : "吃前先放一放"
                },{
                    "type" : "text",
                    "content" : "刚煮好的东西温度很高，着急地吃很容易引起上火，而且还容易烫伤口腔和食道的黏膜，建议煮好的东西先在盘子里放一放，等到凉了一些后再吃。"
                },{
                    "type" : "title",
                    "content" : "荤素搭配着吃"
                },{
                    "type" : "text",
                    "content" : "吃火锅别光吃肉，和丸子，最好是吃鸳鸯锅底，蔬菜放在清水汤那边煮，荤素搭配着吃比较不容易上火，注意蔬菜别煮得太熟，以免久煮破坏蔬菜的维生素，影响清热效果。"
                },{
                    "type" : "title",
                    "content" : "冬季吃火锅要注意的事项"
                },{
                    "type" : "title",
                    "content" : "1、涮火锅时要先食用海鲜类食物"
                },{
                    "type" : "text",
                    "content" : "许多人喜欢吃海鲜，尤其是涮火锅的时候，各种贝类、虾类、鱼类食物都是他们的最爱，而这些食物食用起来也的确非常美味诱人。健康饮食专家提醒，海鲜虽然美味，但一定要先行食用。因为，海鲜类食物不易消化，先吃后让胃酸有个消化过程。另外，海鲜不易食用过量，大量食用海鲜会对胃酸和胃蛋白酶的需求加大，从而增加胃消化功能的强度，导致胃肠道功能出现紊乱现象而引起腹泻。海鲜类食物的蛋白质含量很高，过量食用也会给肾脏功能增加负担。另外，还要提一句，孕妇能吃火锅吗？准妈妈最好少吃或不吃火锅"
                },{
                    "type" : "title",
                    "content" : "2、慎选中药火锅底"
                },{
                    "type" : "text",
                    "content" : "现在不少商家推出养生保健、美容养颜的滋补火锅，很多消费者都不了解经营者的火锅底中到底有哪些滋补药品和药性，盲目地选择这种添加中草药的锅底后，不仅起不了滋补保健的效果，有时还会影响身体健康。因为，不是所有人都适合吃中药火锅的。其实，经营者在火锅中加入豆蔻、桂皮、砂仁等药材并没有经过特定的煎煮，这些药材也只能起去膻、除腥、调味的功效，而药物的疗效并不大。另外，很多人对中药是有禁忌的，如果饮食不当身体受损是很有可能的。"
                },{
                    "type" : "title",
                    "content" : "3、避免过量食用鱼丸肉丸"
                },{
                    "type" : "text",
                    "content" : "许多人觉得羊肉、肥牛的脂肪含量过高，吃火锅时往往用鱼丸肉丸代替，认为鱼丸肉丸的油含量较少可以大量食用。其实，这样想是错误的，也是一个生活中的误区。鱼丸和肉丸在制作加工过程中添加了大量的油脂和盐分，不适宜患高血压、糖尿病和高血脂患者过量食用。吃火锅时尽量选择油脂含量低、脂肪低的瘦肉和海鲜食品，也可以用鸡肉片、里脊肉片、百叶等低脂肪食物代替，同时也可以选择豆腐或豆皮来代替肉类食品，以补充植物蛋白量。注意营养均衡、荤素搭配的原则，尽量不要吃得太油腻。"
                },{
                    "type" : "title",
                    "content" : "4、吃完后不要喝火锅汤"
                },{
                    "type" : "text",
                    "content" : "很多人喜欢喝火锅的汤，说很浓很好味道，又是精华所在；其实还是少吃为佳，因为火锅多数是以肉类、菜蔬、菇类及海鲜为主，这些食物材料一齐煮熟后的汤，产生浓度极高的物质，进入肠胃消化分解后，经肝藏代谢生成尿酸，可使肾功能减退、排泄受阻，会使过多的尿酸沉积在血液和组织中，而引发痛风病，所以吃火锅时应多饮水，以利尿酸的排出。"
                },{
                    "type" : "title",
                    "content" : "5、吃火锅时空气要流通"
                },{
                    "type" : "text",
                    "content" : "若用炭炉烧火锅，各位就应当小心了，一定要打开窗户，让空气流通；空气不流通，室内缺氧，木炭燃烧不透时，会产生大量的一氧化碳，容易使人中毒，中二氧化碳毒往往不易发觉的，因吃火锅时同时喝了酒，把中毒的症状像恶心、头晕、呕吐及头痛误为醉酒，中毒重者，会发生昏迷、血压下降及口唇呈樱桃红色等，所以若用炭炉烧火锅时千万留意室内通风。"
                }
            ],
            create_time: Date.now()-10*60*1000
        },{
            title: '柠檬怎么吃减肥？',
            summary: '柠檬有减肥的功效大家都知道，而且柠檬中富含丰富的维C，不仅能够补充身体所需要的营养素，同时还能够促进体内的新陈代谢，有效燃烧脂肪，最终达到减肥的效果。那么柠檬怎么吃才更减肥呢？',
            cover: {
                cover_img: 'https://foodcover.oss-cn-hangzhou.aliyuncs.com/20170109151546342849110169539.jpg',
                cover_width: '320',
                cover_height: '240'
            },
            tag: '瘦身饮食',
            source: 'mstx',
            rich_content: [
                {
                    "type" : "title",
                    "content" : "柠檬水"
                },{
                    "type" : "text",
                    "content" : "材料：半粒柠檬，一公升白水。"
                },{
                    "type" : "text",
                    "content" : "做法及吃法："
                },{
                    "type" : "text",
                    "content" : "1、一公升的水里加上半粒柠檬原汁，并放置于冰箱冷却，温度较低则有清凉爽口的感觉;"
                },{
                    "type" : "text",
                    "content" : "2、每日至少喝下6杯，不需特别节食或禁绝零食。"
                },{
                    "type" : "text",
                    "content" : "功效：柠檬水可以解渴和减少食欲，如果加上15分钟的运动，效果会更加显着。早晨起来喝一杯柠檬水，可以清理血液中的毒素，排毒作用非常的好。柠檬水长期饮用，具有长期疗效。有利于补充人体水分、维生素。美容减肥效果兼佳。"
                },{
                    "type" : "title",
                    "content" : "柠檬洋葱丝减肥食谱"
                },{
                    "type" : "text",
                    "content" : "柠檬洋葱丝可以算是一款零热量的凉菜，不但清爽可口，还能够帮助我们击退体内多余的脂肪，并且加强肠胃各项的功能。"
                },{
                    "type" : "text",
                    "content" : "制作这道凉菜需要准备的材料有：柠檬、洋葱、鱼露和食盐。"
                },{
                    "type" : "text",
                    "content" : "1、首先把洋葱剥皮切丝，放入干净的保鲜袋中，撒入适量的食盐摇晃均匀。"
                },{
                    "type" : "text",
                    "content" : "2、然后把洋葱丝倒入盘中，倒入适量的鱼露搅拌均匀。"
                },{
                    "type" : "text",
                    "content" : "3、柠檬皮剥下后切丝，柠檬肉对半切开，把柠檬汁挤入洋葱里，最后撒上柠檬丝就可以了。"
                },{
                    "type" : "title",
                    "content" : "柠檬冰红茶"
                },{
                    "type" : "text",
                    "content" : "这款饮品冰爽可口，非常受到大众的喜爱，是消暑去热的佳品。而且茶叶中的茶多酚还可以帮助我们分解脂肪，和柠檬搭配起来瘦身效果非常强大。"
                },{
                    "type" : "text",
                    "content" : "我们需要准备以下材料：柠檬、蜂蜜、红茶包。"
                },{
                    "type" : "text",
                    "content" : "1、把红茶包在开水中浸泡一分钟，然后取出放在一旁。"
                },{
                    "type" : "text",
                    "content" : "2、等红茶变凉之后，把它倒入一个个冷冻格中，装进冰箱冻成红茶冰块。"
                },{
                    "type" : "text",
                    "content" : "3、柠檬切片，和红茶冰块一同放入容器中。再次把红茶包放入沸水中浸泡一分钟。"
                },{
                    "type" : "text",
                    "content" : "4、最后把热热的红茶水倒入柠檬和冰块中，可以激发非常特别的味道。加入适量的蜂蜜调味即可。"
                }
            ],
            create_time: Date.now()+70*60*1000
        }], function(error, result) { 
            res.json({code: successCode, msg: ""}); 
            db.close();
        });
    });

});

app.get('/getnews', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");

    var pageNo = parseInt(req.query.pageNo);
    var userId = req.query.userId;
    var skipCount = (pageNo-1)*10;
    MongoClient.connect(DB_CONN_STR, function(err, db) {
        var collection = db.collection('news');
        collection.find({source:{$ne:"hema"}}, {rich_content: 0}).sort({'create_time':-1}).limit(10).skip(skipCount).toArray(function(err, items){        
            if(items.length>0) {
                res.json({code: successCode, msg: "", data: items});
            } else {
                res.json({code: failCode, msg: "没有更多了~"});
            }
            //关闭数据库
            db.close();
        });
    });
});

app.get('/newsdetail', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");

    var id = req.query.id;
    var userId = req.query.userId;
    MongoClient.connect(DB_CONN_STR, function(err, db) {
        var collection = db.collection('news');
        collection.findOne({_id: ObjectID(id)}, function(err1, item){        
            if(err1) {
                res.json({code: failCode, data: err1}); 
                db.close();
                return;
            } 

            res.json({code: successCode, msg: "", data: item});
            db.close();
        });
    });
});

app.get('/souxiangke', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");

    var name = req.query.name;
    MongoClient.connect(DB_CONN_STR, function(err, db) {
        var collection = db.collection('xiangke');
        collection.findOne({name: name}, function(err1, item){        
            if(err1) {
                res.json({code: failCode, data: err1}); 
                db.close();
                return;
            } 

            res.json({code: successCode, msg: "", data: item});
            db.close();
        });
    });
});

var options = {
    key: fs.readFileSync('./keys/214248838510598.key'),
    cert: fs.readFileSync('./keys/214248838510598.pem')
};
https.createServer(options, app).listen(3000, function(req, res){
    console.log('server is running on port 3000');
});
