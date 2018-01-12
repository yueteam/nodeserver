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
            title: '真相！每天吃西兰花真的能瘦成一道闪电吗',
            summary: '说起西兰花，大家都知道这是健身人士最常食用的蔬菜，那他为什么受到广大健身人士的欢迎呢？最大的魅力到底在哪儿呢？',
            cover: {
                cover_img: 'https://foodcover.oss-cn-hangzhou.aliyuncs.com/10016772255.jpg',
                cover_width: '900',
                cover_height: '600'
            },
            tag: '瘦身',
            source: 'mstx',
            rich_content: [{
                    "type" : "text",
                    "content" : "首先，西兰花制作起来很简单，放在开水里泡几分钟，就能取出来吃了，非常方便。其次，西兰花饱腹感很强，会让你减掉更多脂肪！最后，它的蛋白含量比普通叶子菜类要高出3-4倍，当然其他微量元素含量也更高，这让很多健身人士难以拒绝！但仅仅如此吗？"
                },
                {
                    "type" : "picture",
                    "pic_url" : "https://foodcover.oss-cn-hangzhou.aliyuncs.com/3281273851.gif",
                    "pic_width" : "512",
                    "pic_height" : "288"
                },
                {
                    "type" : "text",
                    "content" : "NO！NO！NO！它最大的功能在于抗雌，为何会有抗雌这个说法？很简单，男性体内其实是一个雄性激素和雌性激素动态平衡的场所，此消彼长，当雌性激素升高，则雄性激素减少！睾酮降低会造成男性肌肉减少，欲望消退，那么哪几种人雌性激素容易升高呢？"
                },
                {
                    "type" : "text",
                    "content" : "经常喝酒的、有脂肪肝的、啤酒肚比较大的、健身使用类固醇的，这些都容易产生雌性激素升高问题；而我们普通人若经常工作压力巨大、缺少睡眠、频繁使用医用药物、使用不洁水和摄入激素偏多的食物，也会引起雌性激素升高！"
                },
                {
                    "type" : "text",
                    "content" : "可以这么说，不良生活习惯和糟糕的身体状况会让男人睾酮越来越低，甚至经常锻炼的大爷睾酮都比30岁左右的人高。（难以想象有木有！）"
                },
                {
                    "type" : "picture",
                    "pic_url" : "https://foodcover.oss-cn-hangzhou.aliyuncs.com/3281273850.gif",
                    "pic_width" : "513",
                    "pic_height" : "288"
                },
                {
                    "type" : "text",
                    "content" : "那对于女人就没有好处了？那你就大错特错了！如果各位对蔬菜有研究的话，应该会注意到西兰花会帮助抗氧化，帮助抗癌，其实这个抗癌就是指的乳腺癌，这在医学中，已经有大量的实验证明过这一现象。为何会有乳腺癌，很多女孩就是因为雌性激素过高导致的。"
                },
                {
                    "type" : "text",
                    "content" : "而二吲哚基甲烷（DIM）从西兰花中提取而来的，是一种有效的促进雌激素代谢剂，能够加速雌激素的代谢和清除，改善雌激素过多症。"
                },
                {
                    "type" : "text",
                    "content" : "而健身人士最担心的就是雌性激素增多，所以西兰花就成了非常重要的选择，普通的男性女性朋友最好也应该多食用，当然除了西兰花还有许多其他菜也可以抗雌，比如：羽衣甘蓝、白菜、包菜、萝卜、水田芥菜等等食物。"
                },
                {
                    "type" : "text",
                    "content" : "了解了这么多，就在于一句话：多吃西兰花吧，营养健康少不了！"
                }
            ],
            create_time: Date.now()+5*3600*1000
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
