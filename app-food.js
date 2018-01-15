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

app.get('/shiliaodetail', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");

    var id = req.query.id;
    MongoClient.connect(DB_CONN_STR, function(err, db) {
        var collection = db.collection('shiliao');
        collection.findOne({pinyin: id}, function(err1, item){        
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
            title: '吃3款早餐，减肥很简单',
            summary: '其实如果不吃早餐的话，并不能减肥，反而可能还会增肥。那么怎么早餐怎么吃不仅一点也不会胖反而还能减肥呢？粥品是早餐的绝佳选择，以下小编推荐3款瘦身粥，让你快速瘦出苗条身材! ',
            cover: {
                cover_img: 'https://foodcover.oss-cn-hangzhou.aliyuncs.com/201801152206.jpg',
                cover_width: '620',
                cover_height: '480'
            },
            tag: '瘦身',
            source: 'mstx',
            rich_content: [
                {
                    "type" : "title",
                    "content" : "豆浆红薯粥"
                },{
                    "type" : "text",
                    "content" : "材料：大米少许、红薯1个、黄豆适量"
                },{
                    "type" : "text",
                    "content" : "做法：1、将豆子洗净并浸泡一夜，红薯洗净去皮并切块。2、将泡一夜后的豆子打成浆，煮沸。3、加入红薯块和少许大米。小火慢煮至浓稠即可。"
                },{
                    "type" : "text",
                    "content" : "提示：研究发现，每100克红薯含脂肪仅为0.2克，是大米的1/4。因此红薯是低热量、低脂肪食品中的佼佼者。除此之外，红薯还含有均衡的营养成份。助你填满肚子的同时，轻松甩掉小肉肉哦!"
                },{
                    "type" : "title",
                    "content" : "白菜粥"
                },{
                    "type" : "text",
                    "content" : "材料：大白菜、熟米饭。(白菜与米饭的比例是4：1，如果是家常早餐，白菜和米饭的比例可以是2：1。"
                },{
                    "type" : "text",
                    "content" : "做法"
                },{
                    "type" : "text",
                    "content" : "1、将白菜切成短丝，准备好葱姜蒜末。"
                },{
                    "type" : "text",
                    "content" : "2、在热锅中倒入适量的油、用葱姜蒜爆锅后再放入白菜丝翻炒，出汤后加水和米饭，改成中火熬制，直至将米粥熬粘为止。"
                },{
                    "type" : "text",
                    "content" : "3、出锅前放入少量的盐。"
                },{
                    "type" : "title",
                    "content" : "香菇肉丝粥"
                },{
                    "type" : "text",
                    "content" : "材料：香菇5朵，鸡肉丝100克，玉米粒40克，红萝卜60克，新鲜莲子30克，红枣8个，白米75克，芡实、山药各15克，盐适量，姜母3片，青葱2根，胡椒粉酌量。"
                },{
                    "type" : "text",
                    "content" : "做法：1、先把玉米粒洗净、红萝卜洗净后切成丁、鸡肉洗净后切成丝备用。2、把姜母、香菇、青葱切好备用。3、把红枣、莲子、芡实、山药、白米洗干净备用。4、在锅子放入油1大匙，先用小火烧热后放入葱花、姜母、香菇炒香，然后再放入所有食材，但鸡肉丝除外，直到炒熟后放入鸡肉丝继续炒，等到鸡肉熟了以后倒入白米粥，以及撒上胡椒粉调味即可。"
                },{
                    "type" : "text",
                    "content" : "提示：香菇肉丝粥能降脂降压、益肾补脾。"
                },
            ],
            create_time: 1516016906535
        },{ "title" : "冬季孕妈首选的6种水果", "summary" : "孕妈妈们都会为了保证宝宝的营养多吃一些水果，那么现在到了冬天，孕妈妈都想知道吃什么水果更合适呢？毕竟冬天这么冷，吃哪些水果更合适呢？", "cover" : { "cover_img" : "https://foodcover.oss-cn-hangzhou.aliyuncs.com/201801151839.jpg", "cover_width" : "500", "cover_height" : "400" }, "tag" : "母婴", "source" : "mstx", "rich_content" : [ { "type" : "title", "content" : "香蕉" }, { "type" : "text", "content" : "香蕉富含叶酸，能够帮助预防胎儿畸形。而且吃些香蕉还能增强抵抗力、提高食欲、保护神经系统，流感节吃它准没错。" }, { "type" : "title", "content" : "牛油果" }, { "type" : "text", "content" : "冬天吃水果实在太冷了？试试牛油果吧，能做沙拉还能做热菜。牛油果中含有的丰富的天然叶酸，对胎儿发育有重要作用，而且吃牛油果还有利于预防孕期便秘和降低胆固醇。" }, { "type" : "title", "content" : "柑橘" }, { "type" : "text", "content" : "柑橘类水果被称为冬天的水果之王，不仅富含维生素C，还含有生物碱，能促进体脂分解，提高新陈代谢，帮助孕妈控制体重。" }, { "type" : "title", "content" : "草莓" }, { "type" : "text", "content" : "草莓的维生素C比柑橘柠檬还高，通便能力比香蕉强多了，抗氧化能力比猕猴桃强好几倍，冬季养颜养胎，千万别错过它！" }, { "type" : "title", "content" : "苹果" }, { "type" : "text", "content" : "苹果能够给准妈妈带来丰富的维生素、矿物质、苹果酸鞣酸、细纤维等营养。准妈妈多吃苹果可以缓解孕吐、增进食欲;苹果还能帮助孕妇预防便秘以及改善贫血状况哦！" }, { "type" : "title", "content" : "樱桃" }, { "type" : "text", "content" : "水果樱桃含有丰富的铁元素、胡萝卜素、维生素b族c族、柠檬酸、钙、磷等营养成分，准妈妈多吃樱桃对肠胃很好，具有增进食欲以及改善贫血的症状等功效。" }, { "type" : "title", "content" : "孕妇冬天吃水果要注意什么" }, { "type" : "text", "content" : "孕期食用水果，应该注意“度”和“道”。“度”是指食用水果应该适量，而“道”是指食用水果应该注意方法。" }, { "type" : "text", "content" : "1、水果中含有发酵糖类物质，因此吃后最好漱口。对其过敏，易发湿疹者不宜食用。" }, { "type" : "text", "content" : "2、进食瓜果一定要注意饮食卫生，生吃水果前必须洗净外皮，不要用菜刀削水果，避免将寄生虫卵带到水果上。" }, { "type" : "text", "content" : "3、适量：水果的补充，每天最多不要超过200克，尽量选择含糖量低的水果，不要无节制食用西瓜等高糖分水果。" }, { "type" : "text", "content" : "4、适时：吃水果宜在饭后2小时内或饭前1小时，饭后立即吃水果，会造成胀气和便秘。" }, { "type" : "text", "content" : "5、禁忌：山楂、木瓜最好不吃。山楂对子宫有一定的兴奋作用，会促使子宫收缩。如果孕妇们大量食用山楂，就可能会导致流产。木瓜中含有女性荷尔蒙，容易干扰孕妇体内的荷尔蒙变化，尤其是青木瓜，孕妇更应完全戒除。因为它不但对胎儿的稳定度有害，还有可能导致流产。" }, { "type" : "text", "content" : "另外，对于那些非常喜欢吃水果的孕妇，孕妇最好在怀孕第24周到第28周时，去医院进行定期血糖测定，随时监控，避免妊娠糖尿病的发生。" } ], "create_time" : 1516013306435 }], function(error, result) { 
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
