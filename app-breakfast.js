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
var DB_CONN_STR = 'mongodb://localhost:27017/breakfast'; 

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
 * [breakfast] 人人许愿
 * @type {Object}
 */
app.get('/tGFrYeQFZG.txt', function(req, res){
    res.send('5dc88363851a7957e9616c47004dc67e');
});
var breakfastWXInfo = {
        appid: 'wx2992e5dce30736a9',
        secret: 'b2befe7883f36ddc7808c998b27158a0'
    };
app.get('/', function(req, res){
    res.send('<h1>时刻有约</h1>');
});

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
       
    MongoClient.connect(DB_CONN_STR, function(err, db) {
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
            var result = yield client1.putStream(id+'.png', stream);
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
    MongoClient.connect(DB_CONN_STR, function(err, db) {
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
        // cookTime: Number(req.body.cookTime),
        forkCount: 0,
        fork_users: [],
        day: dayStr,
        createTime: now
    };
    // if(userId === '5a40efbcf18ac53540f49459') {
    //     mealInfo.official = true;
    // }
    MongoClient.connect(DB_CONN_STR, function(err, db) {
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
    MongoClient.connect(DB_CONN_STR, function(err, db) {
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
    MongoClient.connect(DB_CONN_STR, function(err, db) {
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
    MongoClient.connect(DB_CONN_STR, function(err, db) {
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
    MongoClient.connect(DB_CONN_STR, function(err, db) {
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
    MongoClient.connect(DB_CONN_STR, function(err, db) {
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
    MongoClient.connect(DB_CONN_STR, function(err, db) {
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
    MongoClient.connect(DB_CONN_STR, function(err, db) {
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
    MongoClient.connect(DB_CONN_STR, function(err, db) {
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
    MongoClient.connect(DB_CONN_STR, function(err, db) {
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
                // cookTime: item.cookTime,
                forkCount: item.forkCount
                // day: item.day,
                // official: item.official || false,
                // materials: item.materials || [],
                // steps: item.steps || []
            }
            if(inArray(userId, item.fork_users) === 1) {
                newItem.forked = true;
            }
            res.json({code: successCode, msg: "", data: newItem});
            db.close();
        });
    });
});
app.post('/editmeal', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");

    var mealId = req.body.id;
    var materials = JSON.parse(req.body.materials);
    var steps = JSON.parse(req.body.steps);
    MongoClient.connect(DB_CONN_STR, function(err, db) {
        var collection = db.collection('meal');
        collection.update({_id: ObjectID(mealId)}, {$set:{materials:materials,steps:steps}}, function(err1, result) {  
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
app.get('/mymeal', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");

    var userId = req.query.userId;
    MongoClient.connect(DB_CONN_STR, function(err, db) {
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

var options = {
    key: fs.readFileSync('./keys/214248838510598.key'),
    cert: fs.readFileSync('./keys/214248838510598.pem')
};
https.createServer(options, app).listen(3000, function(req, res){
    console.log('server is running on port 3000');
});
