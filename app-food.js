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
            title: '养胃护胃5个禁忌不要犯',
            summary: '很多年轻人都有胃病的毛病，大部分都是不良的饮食习惯造成的，那么在生活当中我们该如何保养自己的胃呢？',
            cover: {
                cover_img: 'https://foodcover.oss-cn-hangzhou.aliyuncs.com/a1a79e00665a436b859a027a53bdfe35.jpg',
                cover_width: '400',
                cover_height: '300'
            },
            tag: '食疗',
            source: 'mstx',
            rich_content: [
                {
                    "type" : "title",
                    "content" : "过于疲劳"
                },
                {
                    "type" : "text",
                    "content" : "如果你是个胃病患者，那么建议你要劳逸结合，因为胃病很有可能会因为过于疲劳而变得更加严重。专家提醒，过度疲劳会让肠胃出现供血不足，长期出现这样的情况会导致胃黏膜受到损害，对胃部的保护是非常不利的。"
                },{
                    "type" : "title",
                    "content" : "浓茶与咖啡"
                },
                {
                    "type" : "text",
                    "content" : "很多上班族都会喝浓茶或者咖啡来提神，遇到加班的时候一天还连喝好几杯，但是你要知道，浓茶与咖啡都会伤胃。这是因为这2种饮品都带有让中枢兴奋的成分，大量、长期饮用会引起胃黏膜缺血，从而加重胃病或者引起胃病。"
                },{
                    "type" : "title",
                    "content" : "吃饭太急"
                },
                {
                    "type" : "text",
                    "content" : "很多朋友之所以会换上胃病，与平常吃饭的坏习惯有很大的关系。有不少人在吃饭的时候都很赶时间，一碗饭三下两下就扒拉进肚子，狼吞虎咽的后果就是食物还没有被完全嚼烂就吞进肚子会对胃部造成伤害，这样做也会加重胃部消化功能的负担，建议胃不好人吃饭不能太急，无论是吃干饭还是喝粥，都要细嚼慢咽。"
                },{
                    "type" : "title",
                    "content" : "精神紧张"
                },
                {
                    "type" : "text",
                    "content" : "胃部是非常娇嫩的，当人们的精神经常处于高度紧张的状态下也会影响到胃部的健康。紧张、愤怒、生气等不良情绪会通过大脑皮质影响到胃部的正常工作，此时胃会分泌出过多的胃酸以及胃蛋白酶，这些元素最终都有可能引起胃溃疡。"
                },{
                    "type" : "title",
                    "content" : "滥用药物"
                },
                {
                    "type" : "text",
                    "content" : "滥用药物不仅会引起药物性肝损伤，还会影响胃部的健康。专家提醒，容易伤到胃部的药物有乙酰水杨酸类的药物、激素类药物等，如果因为身体原因要服用这些药物，那么一定要遵守医嘱，病情好转后最好停药以免对胃部造成更大的伤害。"
                },{
                    "type" : "title",
                    "content" : "生活中如何养胃好"
                },{
                    "type" : "title",
                    "content" : "做好保暖措施"
                },
                {
                    "type" : "text",
                    "content" : "天冷以后注意腹部的保暖也可以养胃，保护好腹部可以避免寒气入侵到胃里造成胃寒等病症，特别患有老胃病的朋友，秋冬时节更要注意胃部的保暖。"
                },{
                    "type" : "title",
                    "content" : "注意饮食习惯"
                },
                {
                    "type" : "text",
                    "content" : "饮食与胃是避不开的关系，想要保护好胃部，那么改变自己不健康、不正确的饮食习惯是非常有必要的。专家认为，胃不好的人要避开生冷、辛辣等带有刺激性的食物，多吃温热食物能养胃。"
                }
            ],
            create_time: Date.now()+6*3600*1000
        },{
            title: '气温骤降，这些食物可以为你提高抵抗力！',
            summary: '今日，全国多地出现雨雪天气，个别地方还有暴雪，大家出行一定要注意安全，生活上也要注意保暖，以防生病。饮食上，多注意为身体补充营养，提高抵抗力',
            cover: {
                cover_img: 'https://foodcover.oss-cn-hangzhou.aliyuncs.com/d373668b566afc274b53e6b8cd6d102c.jpg',
                cover_width: '550',
                cover_height: '366'
            },
            tag: '食疗',
            source: 'mstx',
            rich_content: [
                {
                    "type" : "title",
                    "content" : "深绿色和橙黄色蔬菜增维生素A"
                },
                {
                    "type" : "text",
                    "content" : "专家表示，橙黄色蔬菜富含胡萝卜素，可在人体中转化成维生素A，维生素A可以增强人体上皮细胞的功能，对感冒病毒产生抵抗力，它可以强健咽喉和肺部的黏膜，保持它们正常的新陈代谢。"
                },{
                    "type" : "text",
                    "content" : "绿色蔬菜特别丰富的叶酸是免疫物质合成所需的因子，而大量的类黄酮能够和维生素C共同作用，对维护抵抗力很有帮助。能够促进干扰素等抗病毒物质合成，以及高某些免疫指标。"
                },
                {
                    "type" : "text",
                    "content" : "提示：西兰花、菠菜、芥蓝、芦笋等。白萝卜、葱姜蒜之类虽然不是绿叶蔬菜，也同样具有提高抵抗力的作用。每天至少吃一斤菜是硬道理，品种要多一些。记得浅色蔬菜生吃效果最好，加热时间不要太久，更不要油炸。另外，胡萝卜炒着吃能更好地发挥其营养价值。南瓜可蒸、可煮，亦可洗净切片，用盐腌几小时后，用醋凉拌，只需简单烹饪即可变成一道营养又美味的菜肴。此外，猪肝、鸡肝中也含较多维生素A，也可以适当地食用。"
                },{
                    "type" : "title",
                    "content" : "深色水果补足多种维生素"
                },
                {
                    "type" : "text",
                    "content" : "水果是很好的补充多种维生素的选择，且每种水果都有其不可替代的营养价值。花青素对激发免疫系统的活力很有效。应经常选择富含维生素C和花青素的水果。如香蕉、橘子、猕猴桃、草莓、红枣等。"
                },{
                    "type" : "text",
                    "content" : "提示：富含维生素C和花青素的水果，如香蕉、橘子、猕猴桃、蓝莓、桑葚、草莓等，美国人推荐的蓝莓虽然好，但其在国内产量有限，可选择蓝莓干。水果每天吃半斤到一斤之间即可，尽量选择应季的品种比较好。"
                },{
                    "type" : "title",
                    "content" : "鸡蛋豆类补足优质蛋白质"
                },
                {
                    "type" : "text",
                    "content" : "蛋白质是人体免疫系统的关键物质，抗体的本质就是特殊功能的蛋白质物质。所以，我们必须保证从食物中经常摄入一定量的优质蛋白质。优质蛋白质主要来源于奶类、蛋类、鱼虾类、瘦肉和大豆及制品。"
                },{
                    "type" : "text",
                    "content" : "在植物蛋白中，大豆蛋白质的好处是地球人都知道，但大豆中还有不少能够改善免疫力的物质，比如有抗病毒作用的皂甙，还有激活免疫系统的凝集素。平日里，如果有条件的话，在家里可以自己榨豆浆来喝，既环保又健康。尽量不要选油炸豆腐泡之类煎炸的豆制品，豆腐、豆腐丝、豆腐皮、豆腐干、豆浆都很不错。"
                },
                {
                    "type" : "text",
                    "content" : "动物蛋白中，牛奶、蛋类中的蛋白质是最好的，因此要养成每天坚持喝牛奶、吃鸡蛋的习惯。"
                },{
                    "type" : "title",
                    "content" : "提示：专家提醒，补充蛋白质“适量”同样重要，过多摄入，也会损害机体免疫力。因为过多摄入大鱼大肉，反而增加了胃肠负担，影响蛋白质吸收和充分利用，也影响其他营养素的吸收利用。各种营养素要互相配合，互相制约，共同保护和提高机体免疫力。"
                },{
                    "type" : "title",
                    "content" : "提倡薯类食品做主食"
                },
                {
                    "type" : "text",
                    "content" : "用薯类食物替代精白米面做主食，能够在饱腹的同时提供大量维生素C、维生素B1、钾、膳食纤维等，其中山药、芋头、红薯还含有具免疫促进活性的黏蛋白，对于提高抵抗力很有帮助。除了薯类之外，多吃颜色深红或黑色的粗粮、豆子对提高免疫力也有帮助。"
                },
                {
                    "type" : "text",
                    "content" : "提示：一定要注意是用薯类食品替代主食，不是在吃一大碗米饭之后再吃一大块烤红薯。记得不要吃油炸的薯类食品，可以用蒸煮炖的方法加热。"
                },{
                    "type" : "title",
                    "content" : "补锌可选谷物杂粮海产品"
                },
                {
                    "type" : "text",
                    "content" : "在微量元素中，锌和免疫功能关系密切。锌能增强细胞的吞噬能力，从而发挥杀菌作用。成人补锌可提高免疫力，调节内分泌。"
                },
                {
                    "type" : "text",
                    "content" : "提示：专家表示，谷物中富含对免疫系统至关重要的锌，平时主食可以选择全谷类荞麦面条，或者尝试用各种杂粮做成的营养米饭，这样的主食不仅能填饱肚子，更是简单、上乘的营养佳品。其他含锌的食物还有牡蛎、猪肝、鸡肝、花生、鱼、鸡蛋、牛肉、黑芝麻等。"
                },{
                    "type" : "title",
                    "content" : "酸奶补充优质活菌酸"
                },
                {
                    "type" : "text",
                    "content" : "优质活菌酸奶能帮助人体免疫系统正常工作，这一点已经得到医学界和营养界的公认。"
                },
                {
                    "type" : "text",
                    "content" : "提示：作为补水饮料，绿茶、花茶、菊花茶等都是好选择。每天喝2至3小杯酸奶即可，最好选择新鲜上架的原味酸奶。"
                }
            ],
            create_time: Date.now()+7*3600*1000
        },{
            title: '抵抗流感，这些食物少不了！',
            summary: '元旦过后，新一轮的流感再次来袭，这次是“加强版”，已有很多人出现了感冒的症状。平时要注意饮食，补充身体的营养，提高抵抗力，那么预防感冒吃什么好？',
            cover: {
                cover_img: 'https://foodcover.oss-cn-hangzhou.aliyuncs.com/0f37932ee8d58f4ece85fee6b06ff389.png',
                cover_width: '500',
                cover_height: '355'
            },
            tag: '食疗',
            source: 'mstx',
            rich_content: [
                {
                    "type" : "title",
                    "content" : "冬季吃什么预防感冒"
                },
                {
                    "type" : "title",
                    "content" : "1、谷物杂粮海产品——补锌"
                },{
                    "type" : "text",
                    "content" : "在微量元素中，锌和免疫功能关系密切。锌能增强细胞的吞噬能力，从而发挥杀菌作用。成人补锌可提高免疫力，调节内分泌，宝宝补锌更为关键，提高免疫力的同时还可促进生长发育、智力发育。"
                },
                {
                    "type" : "text",
                    "content" : "谷物中富含对免疫系统至关重要的锌，平时主食可以选择全谷类荞麦面条，或者尝试用各种杂粮做成的营养米饭，这样的主食不仅能填饱肚子，更是简单、上乘的营养佳品。其他含锌的食物还有牡蛎、猪肝、鸡肝、花生、鱼、鸡蛋、牛肉、黑芝麻等。"
                },{
                    "type" : "title",
                    "content" : "2、南瓜胡萝卜——维生素A"
                },
                {
                    "type" : "text",
                    "content" : "从营养学角度来说，维生素A可以增强人体上皮细胞的功能，对感冒病毒产生抵抗力，它可以强健咽喉和肺部的黏膜，保持它们正常的新陈代谢。"
                },{
                    "type" : "text",
                    "content" : "胡萝卜、南瓜、绿色蔬菜中所含有的β-胡萝卜素在身体内可转化为维生素A。而胡萝卜素和维生素A都是脂溶性维生素，因此专家建议，胡萝卜炒着吃能更好地发挥其营养价值。南瓜可蒸、可煮，亦可洗净切片，用盐腌几小时后，用醋凉拌，只需简单烹饪即可变成一道营养又美味的菜肴。此外，猪肝、鸡肝中也含较多维生素A，宜适当食用。"
                },{
                    "type" : "title",
                    "content" : "3、鸡蛋豆类——优质蛋白质"
                },
                {
                    "type" : "text",
                    "content" : "蛋白质是人体免疫系统的关键物质，抗体的本质就是特殊功能的蛋白质物质。所以，我们必须保证从食物中经常摄入一定量的优质蛋白质。优质蛋白质主要来源于奶类、蛋类、鱼虾类、瘦肉和大豆及制品。"
                },{
                    "type" : "text",
                    "content" : "动物蛋白中，牛奶、蛋类中的蛋白质是最好的，因此要养成每天坚持喝牛奶、吃鸡蛋的习惯。而在植物蛋白中最好的是大豆蛋白，平日要多吃豆制品，如豆腐、豆皮、腐竹等。如果您家里有豆浆机，不妨将多种豆类一起放入，这样打出来的豆浆既美味又有不可替代的营养价值。"
                },
                {
                    "type" : "text",
                    "content" : "此外，菌类也是重要的提高免疫力的物质，它们含有的菌类多糖就是提高和保护机体免疫力的有效物质。市场上随处可以买到的牛肝菌、金针菇、蚝蘑、冬菇、香菇，不仅口感好，而且含有丰富的营养物质。其中蛋白质的含量大多在30%以上，比一般蔬菜、水果的含量要高。"
                },{
                    "type" : "text",
                    "content" : "同时专家提醒，补充蛋白质“适量”同样重要，过多摄入，也会损害机体免疫力。因为过多摄入大鱼大肉，反而增加了胃肠负担，影响蛋白质吸收和充分利用，也影响其他营养素的吸收利用。各种营养素要互相配合，互相制约，共同保护和提高机体免疫力。"
                },{
                    "type" : "title",
                    "content" : "4、水果——多种维生素"
                },
                {
                    "type" : "text",
                    "content" : "如果只单纯的靠吃主食和蔬菜来补充营养而忽略了名副其实的维生素之王--水果，那可就是你的失误了。每种水果都有其不可替代的营养价值。应经常选择富含维生素C的水果，如香蕉、橘子、猕猴桃、草莓、红枣等。"
                },
                {
                    "type" : "text",
                    "content" : "而小宝宝吃水果也有讲究，要想宝宝吃得多吃得暖，可以选一些温热性水果，苹果、梨、猕猴桃、香蕉等，制作成水果羹。做法很简单，只需将其切成片（块）煮10分钟，放适量蜂蜜调味即可。"
                }
            ],
            create_time: Date.now()+8*3600*1000
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
