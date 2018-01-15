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
var DB_CONN_STR1 = 'mongodb://localhost:27017/breakfast'; 

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

app.get('/getgongxiao', function(req, res){
    var id = req.query.id;
    var route = 'http://www.meishichina.com/YuanLiao/gongxiao/' + id + '/';
    res.header("Content-Type", "application/json; charset=utf-8");
    superagent.get(route)
    .charset('utf-8')
    .end(function (err, sres) {
        if (err) {
            console.log('ERR: ' + err);
            res.json({code: failCode, msg: err});
            return;
        }
        var $ = cheerio.load(sres.text);
        var dataJson = {},
            shicai = [];
        $('.tui_c ul li').each(function (idx, element) {
            var $element = $(element),
                $link = $element.find('a');
            shicai.push($link.attr('title'));
        }); 
        dataJson = {
            summary: $('.collect_txt').text(),
            shicai: shicai
        };
        MongoClient.connect(DB_CONN_STR, function(err, db) {
            var collection = db.collection('shiliao');

            collection.update({pinyin:id},{$set:dataJson}, function(error, result) { 
                res.json({code: successCode, msg: "", data: result}); 
                db.close();
            });
        }); 
    });
});
app.get('/gethomeinfo', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");

    MongoClient.connect(DB_CONN_STR, function(err, db) {
        var collection = db.collection('homeconfig');
        collection.findOne({name: 'home'}, function(err1, item){ 
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

app.get('/getnews2', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");

    MongoClient.connect(DB_CONN_STR, function(err, db) { 
        var collection = db.collection('news');
        collection.insertMany([{
            title: '冬季孕妈首选的6种水果',
            summary: '孕妈妈们都会为了保证宝宝的营养多吃一些水果，那么现在到了冬天，孕妈妈都想知道吃什么水果更合适呢？毕竟冬天这么冷，吃哪些水果更合适呢？',
            cover: {
                cover_img: 'https://foodcover.oss-cn-hangzhou.aliyuncs.com/201801151839.jpg',
                cover_width: '500',
                cover_height: '400'
            },
            tag: '母婴',
            source: 'mstx',
            rich_content: [
                {
                    "type" : "title",
                    "content" : "香蕉"
                },{
                    "type" : "text",
                    "content" : "香蕉不通便，但是它富含叶酸，能够帮助预防胎儿畸形。而且吃些香蕉还能增强抵抗力、提高食欲、保护神经系统，流感节吃它准没错。"
                },
                {
                    "type" : "title",
                    "content" : "牛油果"
                },{
                    "type" : "text",
                    "content" : "冬天吃水果实在太冷了？试试牛油果吧，能做沙拉还能做热菜。牛油果中含有的丰富的天然叶酸，对胎儿发育有重要作用，而且吃牛油果还有利于预防孕期便秘和降低胆固醇。"
                },
                {
                    "type" : "title",
                    "content" : "柑橘"
                },{
                    "type" : "text",
                    "content" : "柑橘类水果被称为冬天的水果之王，不仅富含维生素C，还含有生物碱，能促进体脂分解，提高新陈代谢，帮助孕妈控制体重。"
                },
                {
                    "type" : "title",
                    "content" : "草莓"
                },{
                    "type" : "text",
                    "content" : "草莓的维生素C比柑橘柠檬还高，通便能力比香蕉强多了，抗氧化能力比猕猴桃强好几倍，冬季养颜养胎，千万别错过它！"
                },
                {
                    "type" : "title",
                    "content" : "苹果"
                },{
                    "type" : "text",
                    "content" : "苹果能够给准妈妈带来丰富的维生素、矿物质、苹果酸鞣酸、细纤维等营养。准妈妈多吃苹果可以缓解孕吐、增进食欲;苹果还能帮助孕妇预防便秘以及改善贫血状况哦！"
                },
                {
                    "type" : "title",
                    "content" : "樱桃"
                },{
                    "type" : "text",
                    "content" : "水果樱桃含有丰富的铁元素、胡萝卜素、维生素b族c族、柠檬酸、钙、磷等营养成分，准妈妈多吃樱桃对肠胃很好，具有增进食欲以及改善贫血的症状等功效。"
                },
                {
                    "type" : "title",
                    "content" : "孕妇冬天吃水果要注意什么"
                },{
                    "type" : "text",
                    "content" : "孕期食用水果，应该注意“度”和“道”。“度”是指食用水果应该适量，而“道”是指食用水果应该注意方法。"
                },{
                    "type" : "text",
                    "content" : "1、水果中含有发酵糖类物质，因此吃后最好漱口。对其过敏，易发湿疹者不宜食用。"
                },{
                    "type" : "text",
                    "content" : "2、进食瓜果一定要注意饮食卫生，生吃水果前必须洗净外皮，不要用菜刀削水果，避免将寄生虫卵带到水果上。"
                },{
                    "type" : "text",
                    "content" : "3、适量：水果的补充，每天最多不要超过200克，尽量选择含糖量低的水果，不要无节制食用西瓜等高糖分水果。"
                },{
                    "type" : "text",
                    "content" : "4、适时：吃水果宜在饭后2小时内或饭前1小时，饭后立即吃水果，会造成胀气和便秘。"
                },{
                    "type" : "text",
                    "content" : "5、禁忌：山楂、木瓜最好不吃。山楂对子宫有一定的兴奋作用，会促使子宫收缩。如果孕妇们大量食用山楂，就可能会导致流产。木瓜中含有女性荷尔蒙，容易干扰孕妇体内的荷尔蒙变化，尤其是青木瓜，孕妇更应完全戒除。因为它不但对胎儿的稳定度有害，还有可能导致流产。"
                },{
                    "type" : "text",
                    "content" : "另外，对于那些非常喜欢吃水果的孕妇，孕妇最好在怀孕第24周到第28周时，去医院进行定期血糖测定，随时监控，避免妊娠糖尿病的发生。"
                }
            ],
            create_time: Date.now()
        },{
            title: '孕妇缓解便秘就吃6种食物',
            summary: '孕妇在怀孕时期，很容易出现便秘的情况，一般孕妇在出现便秘情况的时候，也不会选择吃药，只能是在饮食上下功夫，多吃一些缓解便秘的食物。',
            cover: {
                cover_img: 'https://foodcover.oss-cn-hangzhou.aliyuncs.com/201801151836.jpg',
                cover_width: '960',
                cover_height: '640'
            },
            tag: '母婴',
            source: 'mstx',
            rich_content: [
                {
                    "type" : "title",
                    "content" : "孕妇便秘正常吗？"
                },{
                    "type" : "text",
                    "content" : "便秘是临床常见的复杂症状之一，并不是一种疾病。主要表现为排便次数减少、粪便量减少、粪便干结、排便费力等。判断是否便秘必须结合粪便的性状、本人平时排便习惯和排便有无困难等作出判断。"
                },
                {
                    "type" : "text",
                    "content" : "便秘也是孕期最常见的症状之一，称为妊娠便秘。孕妇便秘高发于妊娠晚期，表现为经常几天没有大便，甚至是1~2周都不能顺利排便，从而导致孕妇腹痛、腹胀发生。便秘是孕期常常被忽略的症状之一，但它的影响可大可小，严重的便秘会导致肠道梗阻，以致发生早产，危及母婴健康。"
                },{
                    "type" : "title",
                    "content" : "孕妇便秘怎么办？"
                },
                {
                    "type" : "title",
                    "content" : "1、增加身体的活动量"
                },{
                    "type" : "text",
                    "content" : "缺乏运动或长时间不活动的话会致便秘情况变得更严重，所以，准妈妈平时要适当运动。准妈妈适当活动能增强胃肠蠕动，睡眠充足、心情愉快使精神压力得到缓解等，同时也是减轻便秘的好方法。散步是最适合准妈妈的运动之一，每天傍晚坚持散步四十分钟，并且散步的时候坚持拍掌，手臂尽可能的张开，以不费力为宜。五个手指也张开，拍掌，直到手臂有点点酸，手掌发热微麻。拍掌能刺激手掌上的各个穴位，促进血液循环，疏通经络。"
                },
                {
                    "type" : "title",
                    "content" : "2、饮食调理"
                },{
                    "type" : "text",
                    "content" : "有便秘困扰的准妈妈，平时要避免吃辛辣的食物，多吃一些富含纤维素和维生素的食物，比如苹果、萝卜、芹菜等蔬菜，香蕉、梨子等水果，蜂蜜、豆类等，这些食物有利于促进肠道的肌肉蠕动，软化粪便，从而起到润肠滑便的作用，帮助孕妇排便。"
                },
                {
                    "type" : "title",
                    "content" : "3、晨起定时排便"
                },{
                    "type" : "text",
                    "content" : "养成早上起来或早餐之后定时排便的习惯。早餐后，结肠推进活动较为活跃，有利于启动排便，早餐后一小时左右是最佳的排便时间。有便意时一定要及时如厕，不要忽视便意，更不要强忍着不便。准妈妈如厕的时间不宜过长，否则容易导致腹压升高，给下肢回流带来困难。"
                },
                {
                    "type" : "title",
                    "content" : "4、注意饮水技巧"
                },{
                    "type" : "text",
                    "content" : "受到便秘困扰的准妈妈平时要多喝水，同时还要掌握喝水的技巧。比如每天在固定的时间内喝水，并且大口大口的喝，但不是暴饮。这样的喝水方法能让水尽快到达结肠，能使粪便变得松软，容易排出体外。"
                },
                {
                    "type" : "title",
                    "content" : "5、慎用药物"
                },{
                    "type" : "text",
                    "content" : "万一孕妇的便秘无法减轻，就必须立即就医，遵医嘱服用通便药物，绝对不能擅自使用药物，但是解决问题的关键还是一些良好生活习惯的建立。"
                },{
                    "type" : "title",
                    "content" : "孕妇出现便秘症状后要吃什么呢？"
                },{
                    "type" : "text",
                    "content" : "孕妇出现便秘症状后要注意多喝汤、多喝水，保证体内有充足的水分，同时要搭配好粗粮和细粮，还要多吃一些新鲜蔬菜和水果。总之，就是让自己的饮食食谱中含有足够的水分。"
                },{
                    "type" : "text",
                    "content" : "为了促进肠胃蠕动，食用的蔬菜和水果最好是含纤维素较多的。另外，建议准妈妈们多喝蜂蜜水，多吃香蕉、燕麦、花生和紫菜，这些都是有助于缓解便秘的食物，但不能吃太多，以免增加肠胃消化负担，适得其反。"
                },{
                    "type" : "title",
                    "content" : "帮助孕妇解决便秘问题的食疗方法有哪些？"
                },{
                    "type" : "text",
                    "content" : "1、胡桃粥：取胡核仁4个，粳米100克。将胡桃仁捣烂同粳米一起煮成粥。"
                },{
                    "type" : "text",
                    "content" : "2、芝麻粥：先取黑芝麻适量，淘洗干净晒干后炒热研碎，每次取30克，同粳米100克煮粥。"
                },{
                    "type" : "text",
                    "content" : "3、黑芝麻、核桃仁、蜂蜜各60克。将芝麻、核桃仁捣碎煮熟后冲入蜂蜜，分两次一日服完。能润滑肠道，通利大便。"
                },{
                    "type" : "text",
                    "content" : "4、番泻叶6克，加红糖适量，开水浸泡代茶饮。"
                },{
                    "type" : "text",
                    "content" : "5、柏子仁粥：取柏子仁30克洗净去杂捣烂，加粳米100克煮粥，服时兑入蜂蜜适量。"
                },{
                    "type" : "text",
                    "content" : "6、无花果粥：无花果30克、粳米100克。先将米加水煮沸，然后放入无花果煮成粥。服时加适量蜂蜜和砂糖。此方适合有痔疮的孕妇食用。"
                }
            ],
            create_time: Date.now()+1*3600*1000
        },{
            title: '孕妇饮食5种营养不可缺',
            summary: '充足的营养对胎儿发育以及孕妈的自身健康都紧密相关，甚至还会影响到产后乳汁分泌以及宝宝出生后的生长发育情况。孕期缺乏营养，很容易影响母体健康以及孩子将来的神经行为和智力水平。孕期怎么吃胎儿才健康？其中五种营养元素是必不可少的哦！',
            cover: {
                cover_img: 'https://foodcover.oss-cn-hangzhou.aliyuncs.com/201801151837.jpg',
                cover_width: '960',
                cover_height: '565'
            },
            tag: '母婴',
            source: 'mstx',
            rich_content: [
                {
                    "type" : "title",
                    "content" : "1、B族维生素"
                },{
                    "type" : "text",
                    "content" : "B族维生素参与了人体复杂的代谢反应，比如维生素B12的重要功能是参与骨骼的造血。富含维生素B族的食物包括有豆类、燕麦片、五谷杂粮、坚果、瘦肉、蛋黄、牛奶等。"
                },
                {
                    "type" : "title",
                    "content" : "2、DHA"
                },{
                    "type" : "text",
                    "content" : "DHA是一种人体必须的不饱和脂肪酸，与胎儿脑部、智力以及眼部发育和神经、血管发育都有密切联系，它还是大脑和视网膜的重要构成成分。富含DHA的食物包括海产鱼、亚麻仁油等。"
                },{
                    "type" : "text",
                    "content" : "除了以上推荐的这些食物外，孕妇平时还可以适当吃一些坚果，比如核桃、花生、板栗等等，坚果中也富含对脑补发育有益的成分，同时还能提高免疫力，促进宝宝的大脑发育。"
                },
                {
                    "type" : "title",
                    "content" : "3、叶酸"
                },{
                    "type" : "text",
                    "content" : "怀孕早期补充叶酸，能大大减少畸形宝宝的发生率。一般建议从怀孕准备开始直到怀孕3个月时都坚持补充叶酸。除了要吃叶酸片外，食物中富含叶酸的有动物肝脏、鸡蛋、豆类、酵母、绿叶蔬菜、水果和坚果。"
                },
                {
                    "type" : "title",
                    "content" : "4、钙"
                },{
                    "type" : "text",
                    "content" : "胎儿的骨骼发育需要大量的钙，如果孕期钙摄取不足够的话，很可能影响胎儿的健康发育以及孕妈咪自身的骨密度和牙齿的健康。孕早期、孕中期和孕晚期摄取钙的含量分别是800、1000和1200毫克。"
                },{
                    "type" : "text",
                    "content" : "孕期补钙可以吃钙片或喝孕妇奶粉，平时常吃的食物中豆制品、黑芝麻、鸡蛋等都含有丰富的钙。值得注意的是，钙的摄取量要控制，补太多容易造成便秘。"
                },
                {
                    "type" : "title",
                    "content" : "5、蛋白质"
                },{
                    "type" : "text",
                    "content" : "蛋白质是人的大脑复杂活动中必不可少的基本物质，对胎儿大脑发育起着至关重要的作用。所以怀孕后，蛋白质的摄取量也要足够。蛋白质含量较多的食物包括肉、鱼、蛋、奶、豆类，基本上每天保持有这一类食物就能满足蛋白质所需。"
                },
                {
                    "type" : "title",
                    "content" : "女性怀孕期间哪些食物不宜多吃呢？"
                },{
                    "type" : "text",
                    "content" : "1.各种“污染”食品。孕妇应避免食用含有添加剂、色素、防腐剂的食品。蔬果等应洗净后才可食用，以免农药残留。"
                },{
                    "type" : "text",
                    "content" : "2.含咖啡因的食品。咖啡因可以在一定程度上改变女性体内雌、孕激素的比例，进而间接抑制受精卵在子宫内的着床和发育。"
                },{
                    "type" : "text",
                    "content" : "3.酒。酒精是导致胎儿畸形和智力低下的重要因素。"
                },{
                    "type" : "text",
                    "content" : "4.腌制食品。腌制食品虽然美味，但其中含有较多的亚硝酸盐、苯丙芘等物质，不利于身体健康。"
                },{
                    "type" : "text",
                    "content" : "5.味精。味精的主要成分是谷氨酸钠，过度进食会影响人体对锌的吸收，不利于胎儿神经系统的发育。"
                },{
                    "type" : "text",
                    "content" : "6.人参、桂圆。中医认为大部分孕妇阴血偏虚，食用妊娠可引起气盛阴耗，加重早孕反应、水肿和高血压等症状。桂圆辛温助阳，孕妇食用后易动血动胎。"
                },{
                    "type" : "text",
                    "content" : "7.过多的糖。糖在人体内的代谢会消耗大量的钙质，如果女性孕期缺钙，会影响胎儿的牙齿、骨骼的发育。此外，过多的糖还容易造成孕妇超重。孕妇应少食。"
                },{
                    "type" : "text",
                    "content" : "8.辛辣食物。辛辣食物刺激性较大，多食可引起便秘。如果正在备孕或已经怀孕的女性食用了大量的辛辣食物，就有可能诱发消化功能障碍。因此，建议孕妇尽量避免食用辛辣食物。"
                }
            ],
            create_time: Date.now()+2*3600*1000
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

/**
 * [breakfast] 人人许愿
 * @type {Object}
 */
var breakfastWXInfo = {
        appid: 'wx2992e5dce30736a9',
        secret: 'b2befe7883f36ddc7808c998b27158a0'
    };

app.get('/bfopenid', function(req, res){
    var code = req.query.code;
    res.header("Content-Type", "application/json; charset=utf-8");

    superagent.get('https://api.weixin.qq.com/sns/jscode2session?appid='+breakfastWXInfo.appid+'&secret='+breakfastWXInfo.secret+'&js_code='+code+'&grant_type=authorization_code')
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

app.get('/bfaccesstoken', function(req, res){
    var code = req.query.code;
    res.header("Content-Type", "application/json; charset=utf-8");
       
    MongoClient.connect(DB_CONN_STR1, function(err, db) {
        var collection = db.collection('wx');
        var requestNewToken = function(){
            superagent.get('https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid'+breakfastWXInfo.appid+'&secret='+breakfastWXInfo.secret)
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
app.get('/bfqrcode', function(req, res){
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

app.get('/addbfuser', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");
    var userInfo = {
        openId: req.query.openId,
        nickName: req.query.nickName,
        gender: Number(req.query.gender),
        language: req.query.language,
        city: req.query.city,
        province: req.query.province,
        country: req.query.country,
        avatarUrl: req.query.avatarUrl
    };
    MongoClient.connect(DB_CONN_STR1, function(err, db) {
        console.log("adduser连接成功！");
        //执行插入数据操作
        var collection = db.collection('user');
        collection.find({"openId":userInfo.openId}).toArray(function(err, items){        
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

app.get('/findbfuser', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");
    var userId = req.query.id;
    MongoClient.connect(DB_CONN_STR1, function(err, db) {
        console.log("findbfuser连接成功！");
        var collection = db.collection('user');
        var collection_meal = db.collection('meal');
        collection.findOne({_id: ObjectID(userId)}, function(err1, item){  
            if(err1) {
                res.json({code: failCode, data: err1}); 
                db.close();
                return;
            }      
            collection_meal.aggregate([{$match:{userId:userId}},{$group:{_id:"$userId", pub_num:{$sum:1}, forked_num:{$sum:"$forkCount"}}}], function(err2, result) {                     
                collection_meal.aggregate([{$match:{fork_users:ObjectID(userId)}},{$group:{_id:1, fork_num:{$sum:1}}}], function(err3, result1) {                        
                    res.json({code: successCode, msg: "", data: item, count: result, count1: result1});
                    db.close();
                });
            });
        });
    });
});

app.post('/uploadcover', upload.single('file'), function (req, res, next) {
    res.header("Content-Type", "application/json; charset=utf-8");

    // 文件路径
    var filePath = './' + req.file.path;  
    // 文件类型
    var fileType = req.file.mimetype;
    var lastName = '';
    switch (fileType){
        case 'image/png':
            lastName = '.png';
            break;
        case 'image/jpeg':
            lastName = '.jpg';
            break;
        default:
            lastName = '.jpg';
            break;
    }
    var userId = req.body.userId;
    // 构建图片名
    var fileName = userId + '_' + Date.now() + lastName;

    co(function* () {
        var result = yield client.put(fileName, filePath);

        // 上传之后删除本地文件
        fs.unlinkSync(filePath);

        res.send(result.url.replace(/http:/,'https:'));  
        db.close();
    }).catch(function (err) {
        console.log(err);
    }); 
})

app.post('/addmeal', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");
    var userId = req.body.userId;
    var now = Date.now(),
        nowdate = new Date(),
        year = nowdate.getFullYear(),
        month = nowdate.getMonth()+1,
        date = nowdate.getDate(),
        dayStr = year+'/'+month+'/'+date;

    var mealInfo = {
        userId: userId,
        avatarUrl: req.body.avatarUrl,
        nickName: req.body.nickName,
        coverImg: req.body.coverImg,
        title: req.body.title,
        desc: req.body.desc,
        forkCount: 0,
        fork_users: [],
        day: dayStr,
        createTime: now
    };
    MongoClient.connect(DB_CONN_STR1, function(err, db) {
        console.log("meal连接成功！");
        var collection = db.collection('meal');
        collection.insert(mealInfo, function(err, result) { 
            //如果存在错误
            if(err) {
                console.log('Error:'+ err);
                res.json({code: failCode, data: err}); 
                db.close();
                return;
            } 
            res.json({code: successCode, msg: "", data: result.insertedIds[0]}); 
            db.close();
        });
    });
});

app.post('/newwish', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");
    var userId = req.body.userId;
    var now = Date.now(),
        nowdate = new Date(),
        year = nowdate.getFullYear(),
        month = nowdate.getMonth()+1,
        date = nowdate.getDate(),
        dayStr = year+'/'+month+'/'+date;

    var wishInfo = {
        user_id: userId,
        avatar_url: req.body.avatarUrl,
        nick_name: req.body.nickName,
        words: req.body.words,
        fav_users: [],
        day: dayStr,
        create_time: now
    };
    MongoClient.connect(DB_CONN_STR1, function(err, db) {
        console.log("wish连接成功！");
        var collection = db.collection('wish');
        collection.insert(wishInfo, function(err, result) { 
            //如果存在错误
            if(err) {
                console.log('Error:'+ err);
                res.json({code: failCode, data: err}); 
                db.close();
                return;
            } 
            res.json({code: successCode, msg: "", data: result.insertedIds[0]}); 
            db.close();
        });
    });
});

function inArray(search, arr) {
    var isExist = 0;
    arr.forEach(function(item){
        if(item.toString() === search){
            isExist = 1;
            return isExist;
        }
    });
    return isExist;
}
app.get('/getmeal', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");

    var pageNo = parseInt(req.query.pageNo);
    var userId = req.query.userId;
    var skipCount = (pageNo-1)*30;
    MongoClient.connect(DB_CONN_STR1, function(err, db) {
        var collection = db.collection('meal');
        collection.find().sort({'createTime':-1}).limit(30).skip(skipCount).toArray(function(err, items){        
            if(items.length>0) {
                var list = [];
                items.forEach(function(item){
                    var newItem = {
                        _id: item._id,
                        userId: item.userId,
                        avatarUrl: item.avatarUrl,
                        coverImg: item.coverImg,
                        title: item.title,
                        desc: item.desc,
                        forkCount: item.forkCount
                    }
                    var forkUsers = item.fork_users;
                    if(inArray(userId,forkUsers) === 1) {
                        newItem.forked = true;
                    }
                    list.push(newItem);
                });
                res.json({code: successCode, msg: "", data: list});
            } else {
                res.json({code: failCode, msg: "没有更多了~"});
            }
            //关闭数据库
            db.close();
        });
    });
});
app.get('/getwish', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");

    var pageNo = parseInt(req.query.pageNo);
    var userId = req.query.userId;
    var skipCount = (pageNo-1)*50;
    MongoClient.connect(DB_CONN_STR1, function(err, db) {
        var collection = db.collection('wish');
        collection.find().sort({'create_time':-1}).limit(50).skip(skipCount).toArray(function(err, items){        
            if(items.length>0) {
                var list = [];
                items.forEach(function(item){
                    var newItem = {
                        _id: item._id,
                        userId: item.user_id,
                        avatarUrl: item.avatar_url,
                        nickName: item.nick_name,
                        words: item.words.split('\n'),
                        day: item.day,
                        favCount: item.fav_users.length
                    }
                    var favUsers = item.fav_users;
                    if(inArray(userId,favUsers) === 1) {
                        newItem.faved = true;
                    }
                    list.push(newItem);
                });
                res.json({code: successCode, msg: "", data: list});
            } else {
                res.json({code: failCode, msg: "没有更多了~"});
            }
            //关闭数据库
            db.close();
        });
    });
});

app.get('/fork', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");

    var userId = req.query.userId,
        mealId = req.query.mealId;
    MongoClient.connect(DB_CONN_STR1, function(err, db) {
        var collection = db.collection('meal');
        collection.update({_id: ObjectID(mealId)}, {$inc: {forkCount: 1}, $addToSet: {fork_users: ObjectID(userId)}}, function(err1, result) {  
            if(err1) {
                res.json({code: failCode, data: err1}); 
                db.close();
                return;
            } 
            res.json({code: successCode, msg: ""});
            db.close();
        });
    });
});

app.get('/unfork', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");

    var userId = req.query.userId,
        mealId = req.query.mealId;
    MongoClient.connect(DB_CONN_STR1, function(err, db) {
        var collection = db.collection('meal');
        collection.update({_id: ObjectID(mealId)}, {$inc: {forkCount: -1}, $pull: {fork_users: ObjectID(userId)}}, function(err1, result) {  
            if(err1) {
                res.json({code: failCode, data: err1}); 
                db.close();
                return;
            } 
            res.json({code: successCode, msg: ""});
            db.close();
        });
    });
});

app.get('/fav', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");

    var userId = req.query.userId,
        wishId = req.query.wishId;
    MongoClient.connect(DB_CONN_STR1, function(err, db) {
        var collection = db.collection('wish');
        collection.update({_id: ObjectID(wishId)}, {$addToSet: {fav_users: ObjectID(userId)}}, function(err1, result) {  
            if(err1) {
                res.json({code: failCode, data: err1}); 
                db.close();
                return;
            } 
            res.json({code: successCode, msg: ""});
            db.close();
        });
    });
});
app.get('/unfav', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");

    var userId = req.query.userId,
        wishId = req.query.wishId;
    MongoClient.connect(DB_CONN_STR1, function(err, db) {
        var collection = db.collection('wish');
        collection.update({_id: ObjectID(wishId)}, {$pull: {fav_users: ObjectID(userId)}}, function(err1, result) {  
            if(err1) {
                res.json({code: failCode, data: err1}); 
                db.close();
                return;
            } 
            res.json({code: successCode, msg: ""});
            db.close();
        });
    });
});
app.get('/wishdetail', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");

    var id = req.query.id;
    var userId = req.query.userId;
    MongoClient.connect(DB_CONN_STR1, function(err, db) {
        var collection = db.collection('wish');
        collection.findOne({_id: ObjectID(id)}, function(err1, item){        
            if(err1) {
                res.json({code: failCode, data: err1}); 
                db.close();
                return;
            } 

            var newItem = {
                _id: item._id,
                userId: item.user_id,
                nickName: item.nick_name,
                avatarUrl: item.avatar_url,
                words: item.words,
                favCount: item.fav_users.length
            }
            res.json({code: successCode, msg: "", data: newItem});
            db.close();
        });
    });
});

app.get('/mealdetail', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");

    var id = req.query.id;
    var userId = req.query.userId;
    MongoClient.connect(DB_CONN_STR1, function(err, db) {
        var collection = db.collection('meal');
        var collection_user = db.collection('user');
        collection.findOne({_id: ObjectID(id)}, function(err1, item){        
            if(err1) {
                res.json({code: failCode, data: err1}); 
                db.close();
                return;
            } 

            var newItem = {
                _id: item._id,
                userId: item.userId,
                nickName: item.nickName,
                avatarUrl: item.avatarUrl,
                coverImg: item.coverImg,
                title: item.title,
                desc: item.desc,
                forkCount: item.forkCount
            }
            if(inArray(userId, item.fork_users) === 1) {
                newItem.forked = true;
            }
            res.json({code: successCode, msg: "", data: newItem});
            db.close();
        });
    });
});
app.get('/mymeal', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");

    var userId = req.query.userId;
    MongoClient.connect(DB_CONN_STR1, function(err, db) {
        var collection = db.collection('meal');
        collection.find({userId: userId}, {title:1,coverImg:1,forkCount:1}).sort({'createTime':-1}).limit(30).toArray(function(err, items){        
            if(items.length>0) {
                res.json({code: successCode, msg: "", data: items});
            } else {
                res.json({code: failCode, msg: "没有"});
            }
            //关闭数据库
            db.close();
        });
    });
});

app.get('/getrank', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");

    MongoClient.connect(DB_CONN_STR1, function(err, db) {
        var collection = db.collection('wish');
        collection.aggregate([{$unwind:"$fav_users"}, {$group:{_id:{wish_id:"$_id",nick_name:"$nick_name",avatar_url:"$avatar_url",words:"$words"},total_fork:{$sum:1}}}, {$sort:{total_fork:-1}}, {$limit:10}], function(err1, result) {                     
            var list = [];
            result.forEach(function(item){
                var newItem = {
                    id: item._id.wish_id,
                    nickName: item._id.nick_name,
                    avatarUrl: item._id.avatar_url,
                    words: item._id.words.split('\n'),
                    favCount: item.total_fork
                }
                list.push(newItem);
            });
            res.json({code: successCode, msg: "", data: list});
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
