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
var client_food = new OSS({
    region: 'oss-cn-hangzhou',
    accessKeyId: 'LTAIrUHBoHLwlUNY',
    accessKeySecret: 'OvuJdzBuziDOIQFRD4gbZXI1fDQ8qC',
    bucket: 'foodcover'
});
var COS = require('cos-nodejs-sdk-v5');
var cos = new COS({
    // 必选参数
    SecretId: 'AKIDxhDUWID690bx2qMfgMluoRs3zhANezPY',
    SecretKey: '0kFTQ7YCPPAhy6ze5HFyUlnbBWcT4QWM',
    // 可选参数
    FileParallelLimit: 3,    // 控制文件上传并发数
    ChunkParallelLimit: 3,   // 控制单个文件下分片上传并发数
    ChunkSize: 1024 * 1024,  // 控制分片大小，单位 B
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

var baseUrl = 'http://www.dbmeinv.com';
app.get('/tags', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");
    superagent.get(baseUrl)
    .charset('utf-8')
    .end(function (err, sres) {
        var items = [];
        if (err) {
            console.log('ERR: ' + err);
            res.json({code: failCode, msg: err, sets:items});
            return;
        }
        var $ = cheerio.load(sres.text);
        $('#main .panel-heading ul.nav li a').each(function (idx, element) {
            var $element = $(element);
            var hrefStr = $element.attr('href');
            var cid = hrefStr.match(/cid=(\d)/);
            cid = isEmpty(cid) ? "0" : cid[1];
            items.push({
                title : $element.text(),
                href : hrefStr,
                cid : cid,
            });
        });
        res.json({code: successCode, msg: "", data:items});
    });
});

app.get('/girls', function(req, res){
    var cid = req.query.c;
    var page = req.query.p;
    cid = !isEmpty(cid) ? cid : '0';
    page = !isEmpty(page) ? page : '1';
    var route = '/dbgroup/show.htm?cid=' + cid + '&pager_offset=' + page;
    res.header("Content-Type", "application/json; charset=utf-8");
    superagent.get(baseUrl+route)
    .charset('utf-8')
    .end(function (err, sres) {
        if (err) {
            console.log('ERR: ' + err);
            return next(err);
        }
        var $ = cheerio.load(sres.text);
        var items = [];
        var t1 = new Date().getTime();
        $('#main .panel-body ul.thumbnails li.span3 .img_single a').each(function (idx, element) {
            var $element = $(element);
            var $subElement = $element.find('img.height_min');
            var thumbImgSrc = $subElement.attr('src');
            items.push({
                title : $subElement.attr('title'),
                href : $element.attr('href'),
                largeSrc : isEmpty(thumbImgSrc) ? "" : thumbImgSrc.replace('bmiddle', 'large'),
                thumbSrc : thumbImgSrc,
                smallSrc : isEmpty(thumbImgSrc) ? "" : thumbImgSrc.replace('bmiddle', 'small'),
            });
        });
        res.json({code: successCode, msg: "", data:items});
    });
});

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

// app.get('/getgongxiao', function(req, res){
//     var id = req.query.id;
//     var route = 'http://www.meishichina.com/YuanLiao/gongxiao/' + id + '/';
//     res.header("Content-Type", "application/json; charset=utf-8");
//     superagent.get(route)
//     .charset('utf-8')
//     .end(function (err, sres) {
//         if (err) {
//             console.log('ERR: ' + err);
//             res.json({code: failCode, msg: err});
//             return;
//         }
//         var $ = cheerio.load(sres.text);
//         var dataJson = {},
//             shicai = [];
//         $('.tui_c ul li').each(function (idx, element) {
//             var $element = $(element),
//                 $link = $element.find('a');
//             shicai.push($link.attr('title'));
//         }); 
//         dataJson = {
//             summary: $('.collect_txt').text(),
//             shicai: shicai
//         };
//         MongoClient.connect(DB_CONN_STR, function(err, db) {
//             var collection = db.collection('shiliao');

//             collection.update({pinyin:id},{$set:dataJson}, function(error, result) { 
//                 res.json({code: successCode, msg: "", data: result}); 
//                 db.close();
//             });
//         }); 
//     });
// });
app.get('/getrecipe', function(req, res){
    var id = req.query.id;
    var route = 'http://www.xiachufang.com/recipe/' + id + '/';
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
        var coverImg = $('.cover img').attr('src');
        var fileName = Date.now()+'.jpg';
        var filePath = './uploads/cover/'+fileName;
        request(coverImg).pipe(fs.createWriteStream(filePath))
        .on('close', function() {
            co(function* () {
                var stream = fs.createReadStream(filePath);
                var result = yield client_food.putStream(fileName, stream);
                fs.unlinkSync(filePath);
            });
        });
        var dataJson = {},
            arr = [],
            arr1 = [];
        $('.ings tr').each(function (idx, element) {
            var $element = $(element);
            arr.push({
                name: trim($element.find('.name').text()),
                unit: trim($element.find('.unit').text())
            });
        }); 
        $('.steps li .text').each(function (idx, element) {
            var $element = $(element);
            arr1.push($element.text());
        }); 
        dataJson = {
            cover_url: 'https://foodcover.oss-cn-hangzhou.aliyuncs.com/'+fileName,
            title: trim($('.page-title').text()),
            summary: '',
            shicai: arr,
            steps: arr1,
            tip: $('.tip').text(),
            fork_users: [],
            create_time: Date.now()
        };
        MongoClient.connect(DB_CONN_STR, function(err, db) {
            var collection = db.collection('recipe');

            collection.insert(dataJson, function(error, result) { 
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

app.get('/meallist', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");

    var pageNo = parseInt(req.query.pageNo);
    var userId = req.query.userId;
    var skipCount = (pageNo-1)*10;
    MongoClient.connect(DB_CONN_STR, function(err, db) {
        var collection = db.collection('recipe');
        collection.find({}, {shicai:0,steps:0,tip:0}).sort({'create_time':-1}).limit(10).skip(skipCount).toArray(function(err, items){        
            if(items.length>0) {
                var list = [];
                items.forEach(function(item){
                    var newItem = item;
                    newItem.fork_count = item.fork_users.length;
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

app.post('/uploadfdcover', upload.single('file'), function (req, res, next) {
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

    // co(function* () {
    //     var result = yield client_food.put(fileName, filePath);

    //     // 上传之后删除本地文件
    //     fs.unlinkSync(filePath);

    //     res.send(result.url.replace(/http:/,'https:')); 
    // }).catch(function (err) {
    //     console.log(err);
    // }); 
    cos.sliceUploadFile({
        Bucket: 'zhishi-1255988328', 
        Region: 'ap-shanghai',
        Key: fileName, 
        FilePath: filePath
    }, function (err, data) {
        // console.log(err || JSON.stringify(data));
        res.send('https://zhishi-1255988328.picsh.myqcloud.com/'+fileName);  

        // 上传之后删除本地文件
        fs.unlinkSync(filePath);
    });
})

app.post('/addrecipe', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");
    var now = Date.now();

    var info = {
        cover_url: req.body.coverImg,
        title: req.body.title,
        summary: req.body.desc,
        cook_time: req.body.cookTime,
        category: '美食',
        fork_users: [],
        author_id: req.body.userId,
        author: {
            id: req.body.userId,
            avatar_url: req.body.avatarUrl,
            nick_name: req.body.nickName
        },
        create_time: now
    };
    MongoClient.connect(DB_CONN_STR, function(err, db) {
        console.log("recipe连接成功！");
        var collection = db.collection('recipe');
        collection.insert(info, function(err1, result) { 
            //如果存在错误
            if(err) {
                console.log('Error:'+ err1);
                res.json({code: failCode, data: err1}); 
                db.close();
                return;
            } 
            res.json({code: successCode, msg: "", data: result.insertedIds[0]}); 
            db.close();
        });
    });
});
app.post('/editrecipe', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");

    var recipeId = req.body.id;
    var shicai = JSON.parse(req.body.shicai);
    var steps = JSON.parse(req.body.steps);
    MongoClient.connect(DB_CONN_STR, function(err, db) {
        var collection = db.collection('recipe');
        collection.update({_id: ObjectID(recipeId)}, {$set:{shicai:shicai,steps:steps}}, function(err1, result) {  
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
app.get('/fork', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");

    var userId = req.query.userId,
        recipeId = req.query.recipeId;
    MongoClient.connect(DB_CONN_STR, function(err, db) {
        var collection = db.collection('recipe');
        collection.update({_id: ObjectID(recipeId)}, {$addToSet: {fork_users: ObjectID(userId)}}, function(err1, result) {  
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
        recipeId = req.query.recipeId;
    MongoClient.connect(DB_CONN_STR, function(err, db) {
        var collection = db.collection('recipe');
        collection.update({_id: ObjectID(recipeId)}, {$pull: {fork_users: ObjectID(userId)}}, function(err1, result) {  
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
app.get('/uprecipe', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");

    var id = req.query.id;
    MongoClient.connect(DB_CONN_STR, function(err, db) {
        var collection = db.collection('recipe');
        collection.update({_id: ObjectID(id)},{$set:{create_time: Date.now()}}, function(err1, item){        
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
            if(item.shicai.length>0) {
                var reg = item.shicai.join('|');

                var collection1 = db.collection('recipe');
                collection1.find({title: {$regex: reg}}, {steps: 0, tip: 0}).sort({'create_time':-1}).limit(20).toArray(function(err2, items){        
                    if(items.length>0) {
                        res.json({code: successCode, msg: "", data: item, recipeList: items});
                    } else {
                        res.json({code: successCode, msg: "", data: item});
                    }
                    
                    //关闭数据库
                    db.close();
                });
            } else {
                res.json({code: successCode, msg: "", data: item});
                db.close();
            }
        });
    });
});

app.get('/recipedetail', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");

    var id = req.query.id;
    MongoClient.connect(DB_CONN_STR, function(err, db) {
        var collection = db.collection('recipe');
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
            superagent.get('https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid='+breakfastWXInfo.appid+'&secret='+breakfastWXInfo.secret)
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
        path = req.query.path,
        width = Number(req.query.width);
    res.header("Content-Type", "application/json; charset=utf-8");
    var filePath = './uploads/qrcode/shaiqrcode.png';
    request({ 
        method: 'POST', 
        url: 'https://api.weixin.qq.com/wxa/getwxacode?access_token=' + accessToken, 
        body: JSON.stringify({path:path,width:width}) 
    }).pipe(fs.createWriteStream(filePath))
    .on('close', function() {
        co(function* () {
            var stream = fs.createReadStream(filePath);
            var result = yield client.putStream('shaiqrcode.png', stream);
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
