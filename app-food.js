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
            title: '肠胃常闹脾气〜5锦囊改善功能性肠胃疾病',
            summary: '俗语说：“肠胃比大脑重要”，但若肠胃常闹脾气，小心可能是功能性肠胃疾病作祟。医生指出，这类疾病好发年轻族群，且女性多于男性，唯有运动、释放压力及均衡饮食，才是改善病灶的重要关键。',
            cover: {
                cover_img: 'https://foodcover.oss-cn-hangzhou.aliyuncs.com/ff308de978bbb2530d75d53e05bfac19.jpg',
                cover_width: '500',
                cover_height: '375'
            },
            tag: '知食',
            source: 'hrjk',
            rich_content: [{
                    "type" : "text",
                    "content" : "功能性肠胃疾病是一种文明病，因压力、大脑过度疲劳引起脑肠轴失调；常见的功能性肠胃疾病包括“胃食道逆流”、“功能性消化不良”及“大肠激躁症”等，症状常以腹痛、便秘呈现。"
                },
                {
                    "type" : "title",
                    "content" : "肠胃比脑重要　影响全身器官"
                },
                {
                    "type" : "text",
                    "content" : "调查发现，这类患者约占肠胃科门诊病人的1/5，且常找不到病因，通常做过各种检查，结果都正常，因为查不出病因，患者就是会不舒服，总是说肚子闷闷的、胀胀的或热热的，说不出个所以然来，只能一再反复就医。"
                },
                {
                    "type" : "text",
                    "content" : "事实上，“肠胃比大脑重要”，决定大脑的健康，又通称“第二大脑”。因为肠道是消化系统的一部分，也是除了大脑之外，人体中最复杂的神经系统，不仅肠道与大脑一样布满了神经细胞，监控着整个肠道功能，更能影响全身大小器官。"
                },
                {
                    "type" : "title",
                    "content" : "改善功能性肠胃病　从生活做起"
                },
                {
                    "type" : "text",
                    "content" : "医学上对功能性肠胃疾病真正的原因仍不清楚，但一般研究发现，在饮食、环境因素、精神因素或胃酸分泌过多的情况下，均会导致胃肠蠕动功能异常，因而产生各种症状。"
                },
                {
                    "type" : "text",
                    "content" : "而要改善这类恼人疾病，务必养成良好生活习惯，也就是在作息上力求规律化，在饮食上力求简单化，在情绪上力求平和化，从日常生活中消除外在的致病因素，尽量松弛身心，减缓压力，并配合药物治疗，杜绝病灶。"
                },
                {
                    "type" : "title",
                    "content" : "保护肠道妙方 保健5小锦囊"
                },
                {
                    "type" : "title",
                    "content" : "1.禁忌食物"
                },
                {
                    "type" : "text",
                    "content" : "减少或避免会诱发、加重症状的食物：例如高油脂、会发酵产生气体的食物、巧克力、乳类、酒精，含咖啡因的咖啡、茶、可乐，碳酸饮料（如苏打）。嚼口香糖会吞下空气，造成胀气，最好避免。"
                },
                {
                    "type" : "title",
                    "content" : "2.细嚼慢咽"
                },
                {
                    "type" : "text",
                    "content" : "避免吃大餐与狼吞虎咽：如果吃三餐会造成腹部绞痛或腹泻，可改为少量多餐。吃太快会吞下空气，造成胀气，因此用餐时最好细嚼慢咽。"
                },
                {
                    "type" : "title",
                    "content" : "3.调理情绪"
                },
                {
                    "type" : "text",
                    "content" : "可以多吃有助血清张力素分泌的食物，如牛奶、豆浆、深绿色蔬菜、香蕉、南瓜、樱桃、坚果、燕麦、大蒜、葡萄柚等改善情绪。"
                },
                {
                    "type" : "title",
                    "content" : "4.规律运动"
                },
                {
                    "type" : "text",
                    "content" : "研究证实，运动能改善功能性肠胃疾病的症状，而心情放轻松、不焦虑，也有助于改善症状。"
                },
                {
                    "type" : "title",
                    "content" : "5.减轻压力"
                },
                {
                    "type" : "text",
                    "content" : "压力或情绪紧张会刺激大肠收缩、痉挛，因此大肠神经特别敏感，且反应剧烈的肠激躁症患者要学习如何减轻压力，以缓和腹部绞痛与其他症状。维持充足的睡眠，可以减缓压力情绪。"
                }
            ],
            create_time: Date.now()
        },{
            title: '冬季养生水果，怎能少了雪梨？',
            summary: '梨是冬季里最合适吃的水果之一了，冬季干燥，而吃梨可以在一定程度上缓解人体干燥，同时润肺生津。梨含有丰富的维生素和钙、磷、铁、碘等微量元素，还有85%的水分，有“天然矿泉水”的美称。如果冬季便秘、内有虚火或者喉咙干痒不舒服，也可以多吃梨子，梨子能帮助疏通肠胃、下火、滋润喉咙和肺部。所以如果说冬季养生的水果怎么少得了梨呢？',
            cover: {
                cover_img: 'https://foodcover.oss-cn-hangzhou.aliyuncs.com/xueli_cover.jpg',
                cover_width: '600',
                cover_height: '400'
            },
            tag: '食疗',
            source: 'mstx',
            rich_content: [{
                    "type" : "title",
                    "content" : "这些水果冬季也可以多吃"
                },
                {
                    "type" : "title",
                    "content" : "樱桃"
                },
                {
                    "type" : "text",
                    "content" : "樱桃不仅仅外表可人，同时所含有的营养物质也是非常的丰富，不仅含有大量的微量元素以及维生素，蛋白质以及碳水化合物的含量也是非常的惊人。研究发现，樱桃中含有的铁元素是大多数水果中最高的，大约是苹果、雪梨的三十倍左右；维生素C的含量则是其他水果的四五倍之多。"
                },
                {
                    "type" : "title",
                    "content" : "橙子"
                },
                {
                    "type" : "text",
                    "content" : "橙子中所含有的维生素C非常的丰富，每天服用半个就能够很好的满足身体对于这种物质的需求。事实上，现如今橙子中含有大量的维生素C已经被很多人所熟知，他也成为了这种物质的代名词。除了维生素C之外，橙子中所含有的维生素P含量也是非常的可观，经常服用橙子能够很好的提高身体抵抗力，减少患病的可能。"
                },
                {
                    "type" : "title",
                    "content" : "草莓"
                },
                {
                    "type" : "text",
                    "content" : "草莓外观呈现心形的红色，并且味酸可口、香气袭人，是很多女孩的最爱。除了外观喜人之外，草莓所含有的营养物质也是非常丰富的，不仅含有大量的维生素C，同时果肉中还含有大量的糖分、蛋白质、果胶以及有机酸等等。除此之外，所含有的维生素其他种类以及微量元素也是非常的惊人，经常服用能够很好的促进身体健康，提高身体抵抗力。"
                },
                {
                    "type" : "title",
                    "content" : "猕猴桃"
                },
                {
                    "type" : "text",
                    "content" : "猕猴桃中含有非常丰富的维生素C，甚至是桔子、苹果这些水果中所含有维生C的好几倍甚至是几十倍，经常服用能够很好的为身体补充足够的维生素。维生素C对于身体的重要性不言而喻，在冬天的时候能够很好的治疗一些皮肤干燥的情况，同时还能够抑制出现皮肤病的可能。"
                },
                {
                    "type" : "title",
                    "content" : "苹果"
                },
                {
                    "type" : "text",
                    "content" : "苹果是一种非常好的水果，其中含有丰富的营养物质，经常服用能够很好的促进身体健康，提高身体抵抗力，减少患有疾病的可能。中医方面认为，服用水果具有很好的保健脾胃、养心以及滋润肺部、肠胃的作用。如果在冬天的时候服用，对于一些咳嗽、喉咙肿痛以及便秘、烦躁的情况具有很好的治疗作用。"
                }
            ],
            create_time: Date.now()
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
