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
    bucket: 'yueavatar'
});
var client1 = new OSS({
    region: 'oss-cn-hangzhou',
    accessKeyId: 'LTAIrUHBoHLwlUNY',
    accessKeySecret: 'OvuJdzBuziDOIQFRD4gbZXI1fDQ8qC',
    bucket: 'yueqrcode'
});
var client2 = new OSS({
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
var DB_CONN_STR = 'mongodb://localhost:27017/yue'; 
var DB_CONN_STR1 = 'mongodb://localhost:27017/breakfast'; 

var baseUrl = 'https://movie.douban.com';
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

var filmWXInfo = {
        appid: 'wx52835d43c1a57fdc',
        secret: 'f76847cd23372f0bb00d83bb2875a697'
    };
app.get('/', function(req, res){
    res.send('<h1>约吗？</h1>');
});

app.get('/nowplaying', function(req, res){
    var city = req.query.city;
    var route = '/cinema/nowplaying/' + city + '/';
    res.header("Content-Type", "application/json; charset=utf-8");
    superagent.get(baseUrl+route)
    .charset('utf-8')
    .end(function (err, sres) {
        if (err) {
            console.log('ERR: ' + err);
            res.json({code: failCode, msg: err});
            return;
        }
        var $ = cheerio.load(sres.text);
        var filmJson = {},
            films = [];
        $('#nowplaying .lists .list-item').each(function (idx, element) {
            if(idx < 15) {
                var $element = $(element),
                    $poster = $element.find('.poster img');
                films.push({
                    id: $element.attr('id'),
                    img : $poster.attr('src'),
                    title : $element.data('title'),
                    score : $element.data('score'),
                    release: $element.data('release'),
                    duration: $element.data('duration'),
                    region: $element.data('region'),
                    director: $element.data('director'),
                    actors: $element.data('actors')
                });
            }
        }); 
        filmJson = {
            filmList: films,
            createTime: Date.now()
        };
        MongoClient.connect(DB_CONN_STR, function(err, db) {
            var collection = db.collection('film');

            //插入数据
            collection.insert(filmJson, function(error, result) { 
                res.json({code: successCode, msg: "", data: result}); 
                db.close();
            });
        }); 
    });
});
app.get('/getcinemas', function(req, res){
    var cityId = req.query.cityId;
    var districtId = req.query.districtId;
    res.header("Content-Type", "application/json; charset=utf-8");

    MongoClient.connect(DB_CONN_STR, function(err, db) {
        var collection = db.collection('cinema');
        collection.find({city_id: cityId, district_id: districtId}).toArray(function(err, items){        
            if(items.length>0) {
                res.json({code: successCode, msg: "", data: items[0].cinemas});

                //关闭数据库
                db.close();
            } else {
                superagent.get('https://movie.douban.com/j/cinema/cinemas/?city_id='+cityId+'&district_id='+districtId)
                .charset('utf-8')
                .end(function (err, sres) {
                    if (err) {
                        res.json({code: failCode, msg: err});
                        return;
                    }
                    var list = JSON.parse(sres.text);
                    collection.insert({
                        city_id: cityId, 
                        district_id: districtId,
                        cinemas: list
                    }, function(error, result) { 
                        res.json({code: successCode, msg: "", data: list}); 
                        db.close();
                    });       
                });
            }
        });
    });

});
app.get('/getfilmlist', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");

    MongoClient.connect(DB_CONN_STR, function(err, db) {
        var collection = db.collection('film');
        collection.find().sort({'createTime':-1}).limit(1).toArray(function(err, items){        
            if(items.length>0) {
                res.json({code: successCode, msg: "", data: items[0].filmList});

                //关闭数据库
                db.close();
            }
        });
    });
});
app.get('/getdistrict', function(req, res){
    var cityId = req.query.cityId;
    res.header("Content-Type", "application/json; charset=utf-8");

    MongoClient.connect(DB_CONN_STR, function(err, db) {
        var collection = db.collection('city');
        collection.find({id: cityId}).toArray(function(err, items){        
            if(items.length>0) {
                res.json({code: successCode, msg: "", data: items[0].district});

                //关闭数据库
                db.close();
            }
        });
    });
});

app.get('/getopenid', function(req, res){
    var code = req.query.code;
    res.header("Content-Type", "application/json; charset=utf-8");

    superagent.get('https://api.weixin.qq.com/sns/jscode2session?appid='+filmWXInfo.appid+'&secret='+filmWXInfo.secret+'&js_code='+code+'&grant_type=authorization_code')
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

app.get('/getaccesstoken', function(req, res){
    var code = req.query.code;
    res.header("Content-Type", "application/json; charset=utf-8");
       
    MongoClient.connect(DB_CONN_STR, function(err, db) {
        var collection = db.collection('wx');
        var requestNewToken = function(){
            superagent.get('https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid='+filmWXInfo.appid+'&secret='+filmWXInfo.secret)
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
app.get('/getqrcode', function(req, res){
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

app.get('/adduser', function(req, res){
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
app.get('/finduser', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");
    var userId = req.query.id;
    MongoClient.connect(DB_CONN_STR, function(err, db) {
        console.log("finduser连接成功！");
        var collection = db.collection('user');
        collection.find({"_id":ObjectID(userId)}).toArray(function(err, items){        
            if(items.length>0) {
                res.json({code: successCode, msg: "", data: items[0]});
            } else {
                res.json({code: failCode, data: '用户不存在'}); 
            }
            db.close();
        });
    });
});
function computeAge(birthday) {
    var birthdayArr = birthday.split("-");  
    var birthYear = birthdayArr[0];  
    var birthMonth = birthdayArr[1];  
    var birthDay = birthdayArr[2]; 
    var d = new Date();  
    var nowYear = d.getFullYear();  
    var nowMonth = d.getMonth() + 1;  
    var nowDay = d.getDate();
    var ageDiff = nowYear - birthYear ; //年之差  

    if(nowMonth == birthMonth) {  
        var dayDiff = nowDay - birthDay;//日之差  
        if(dayDiff < 0) {  
            return ageDiff - 1;  
        }else {  
            return ageDiff ;  
        }  
    } else {  
        var monthDiff = nowMonth - birthMonth;//月之差  
        if(monthDiff < 0) {  
            return ageDiff - 1;  
        } else {  
            return ageDiff;  
        }  
    }
}
function getConstellation(birthday) {
    var birthdayArr = birthday.split("-"),
        birthMonthDay = birthdayArr[1] + '.' + birthdayArr[2],
        birthMonthDay = Number(birthMonthDay);

    if(birthMonthDay >= 3.21 && birthMonthDay <= 4.19) {
        return '白羊座';
    } else if(birthMonthDay >= 4.2 && birthMonthDay <= 5.2) {
        return '金牛座';
    } else if(birthMonthDay >= 5.21 && birthMonthDay <= 6.21) {
        return '双子座';
    } else if(birthMonthDay >= 6.22 && birthMonthDay <= 7.22) {
        return '巨蟹座';
    } else if(birthMonthDay >= 7.23 && birthMonthDay <= 8.22) {
        return '狮子座';
    } else if(birthMonthDay >= 8.23 && birthMonthDay <= 9.22) {
        return '处女座';
    } else if(birthMonthDay >= 9.23 && birthMonthDay <= 10.23) {
        return '天秤座';
    } else if(birthMonthDay >= 10.24 && birthMonthDay <= 11.22) {
        return '天蝎座';
    } else if(birthMonthDay >= 11.23 && birthMonthDay <= 12.21) {
        return '射手座';
    } else if((birthMonthDay >= 12.22 && birthMonthDay <= 12.31) || (birthMonthDay >= 1.1 && birthMonthDay <= 1.19)) {
        return '摩羯座';
    } else if(birthMonthDay >= 1.2 && birthMonthDay <= 2.18) {
        return '水瓶座';
    } else if(birthMonthDay >= 2.19 && birthMonthDay <= 3.2) {
        return '双鱼座';
    } 
}
app.post('/saveuserinfo', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");
    var userId = req.body.userId,
        birthday = req.body.birthday,
        updateInfo = {
            nickName: req.body.nickName,
            gender: Number(req.body.gender),
            birthday: birthday,
            age: computeAge(birthday),
            constellation: getConstellation(birthday),
            personality: req.body.personality,  
            business: req.body.business,  
            company: req.body.company,  
            profession: req.body.profession           
        };

    MongoClient.connect(DB_CONN_STR, function(err, db) {
        console.log("saveuserinfo连接成功！");
        var collection = db.collection('user');
        collection.update({'_id':ObjectID(userId)},{$set:updateInfo}, function(err, result) { 
            //如果存在错误
            if(err) {
                console.log('Error:'+ err);
                res.json({code: failCode, data: err}); 
                db.close();
                return;
            } 
            res.json({code: successCode, msg: "", data: updateInfo}); 
            db.close();
        });
    });
});
app.post('/upload', upload.single('file'), function (req, res, next) {
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
    var userId = req.body.userId,
        index = req.body.index;
    // 构建图片名
    var fileName = userId + '_' + Date.now() + lastName;

    co(function* () {
        var result = yield client.put(fileName, filePath);
            
        var updateInfo = {};
        updateInfo[index] = result.url.replace(/http:/,'https:');

        // 上传之后删除本地文件
        fs.unlinkSync(filePath);

        MongoClient.connect(DB_CONN_STR, function(err, db) {
            console.log("upload连接成功！");
            var collection = db.collection('user');
            collection.update({'_id':ObjectID(userId)},{$set:updateInfo}, function(err, result1) { 
                //如果存在错误
                if(err) {
                    res.json({code: failCode, data: err}); 
                    db.close();
                    return;
                } 
                res.send(result.url.replace(/http:/,'https:')); 
                db.close();
            });
        });
    }).catch(function (err) {
        console.log(err);
    }); 
})

app.post('/pubdate', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");
    var userId = req.body.userId;
    var dateInfo = {
        userId: userId,
        avatarUrl: req.body.avatarUrl,
        nickName: req.body.nickName,
        gender: Number(req.body.gender),
        age: Number(req.body.age),
        constellation: req.body.constellation,
        business: req.body.business,
        company: req.body.company,
        profession: req.body.profession,
        filmId: req.body.filmId+'',
        filmName: req.body.filmName,
        filmCover: req.body.filmCover,
        cityId: req.body.cityId+'',
        cityName: req.body.cityName,
        day: req.body.day,
        time: req.body.time,
        districtId: req.body.districtId+'',
        districtName: req.body.districtName,
        cinemaId: req.body.cinemaId+'',
        cinemaName: req.body.cinemaName,
        cinemaAddress: req.body.cinemaAddress,
        words: req.body.words,
        status: 1, // 0未匹配 1匹配中 2匹配成功
        createTime: Date.now()
    };
    MongoClient.connect(DB_CONN_STR, function(err, db) {
        console.log("db连接成功！");
        var collection = db.collection('dates');
        collection.insert(dateInfo, function(err, result) { 
            //如果存在错误
            if(err) {
                console.log('Error:'+ err);
                res.json({code: failCode, data: err}); 
                db.close();
                return;
            } 
            res.json({code: successCode, msg: "", data: result}); 

            collection.update({userId:userId,status:1,_id:{$ne:ObjectID(result.insertedIds[0])}},{$set:{status:0}}, function(err1, result1) { 
                db.close();
            });
        });
    });
});
app.get('/getdate', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");
    var userId = req.query.userId;

    MongoClient.connect(DB_CONN_STR, function(error, db) {
        console.log("getdate连接成功！");
        var collection = db.collection('dates');
        var collection_pair = db.collection('pair');
        collection.find({userId:userId, $or:[{status:1},{status:2}]}).sort({'createTime':-1}).limit(1).toArray(function(err, items){        
            if(items.length>0) {
                if(items[0].status===1){
                    res.json({code: successCode, msg: "", data: items[0]});
                    db.close();
                } else if(items[0].status===2) {
                    collection_pair.find({pair:{$in:[items[0]._id]}}).toArray(function(err1, arr){ 
                        res.json({code: 2, msg: "匹配成功", data: arr});
                        db.close();
                    });
                }
            } else {
                res.json({code: failCode, data: '没找到'}); 
                db.close();
            }
        });
    });
}); 

app.get('/match', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");
    var id = req.query.id,
        gender = req.query.gender,
        gender1 = gender==1?2:1,
        filmId = req.query.filmId+'',
        cityId = req.query.cityId+'',
        day = req.query.day,
        time = req.query.time,
        districtId = req.query.districtId+'',
        cinemaId = req.query.cinemaId+'';

    var matchInfo = {
        gender: gender1,
        filmId: filmId,
        cityId: cityId,
        day: day,
        time: time,
        status: 1
    };
    let orArr = [];
    if(districtId !== '') {
        orArr.push({districtId:''});
        orArr.push({districtId:districtId});
        matchInfo.$or = orArr;
    } 
    if(cinemaId !== '') {
        orArr.push({cinemaId:''});
        orArr.push({cinemaId:cinemaId});
        matchInfo.$or = orArr;
    }

    MongoClient.connect(DB_CONN_STR, function(err, db) {
        console.log("match连接成功！");
        var collection = db.collection('dates');
        collection.find({_id: ObjectID(id)}).toArray(function(err1, items1){ 
            if(items1[0].status===2) {
                var collection_pair = db.collection('pair');
                collection_pair.find({pair:{$in:[items1[0]._id]}}).toArray(function(err3, items3){ 
                    res.json({code: 2, msg: "匹配成功", data: items3});
                    db.close();
                });
            } else {
                collection.find(matchInfo).sort({'createTime':-1}).limit(100).toArray(function(err2, items2){ 
                    var filterArr = [];
                    if(items1[0].decidedIds && items1[0].decidedIds.length>0) { 
                        var decidedIds = items1[0].decidedIds.join(',');
                        for(var i=0,len=items2.length;i<len;i++) {
                            var dateId = items2[i]._id;
                            if(decidedIds.indexOf(dateId)<0) {
                                filterArr.push(items2[i]);
                            }
                        } 
                    } else {
                        filterArr = items2;
                    }     
                    if(filterArr.length>0) {
                        res.json({code: successCode, msg: "", data: filterArr});
                    } else {
                        res.json({code: failCode, data: '没匹配到'}); 
                    }
                    db.close();
                });
            }
        });
    });
});

app.get('/updatedate', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");
    var dateId = req.query.dateId,
        matchId = req.query.matchId,
        act = req.query.act;

    MongoClient.connect(DB_CONN_STR, function(err, db) {
        console.log("updatedate连接成功！");
        var collection = db.collection('dates');

        collection.find({_id: ObjectID(dateId)}).toArray(function(err1, items){ 
            var loveIdArr = items[0].loveIds || [],
                decidedIdArr = items[0].decidedIds || [];

            decidedIdArr.push(matchId);
            if(act==='yes') {
                loveIdArr.push(matchId);
                collection.find({_id: ObjectID(matchId),loveIds:{$in:[dateId]}}).toArray(function(err2, opposite){ 
                    if(opposite.length>0) {
                        console.log('匹配成功！！！');
                        var pairJson = {
                            status: 1,
                            pair: [
                                ObjectID(dateId),
                                ObjectID(matchId)
                            ],
                            userIds: [
                                ObjectID(items[0].userId),
                                ObjectID(opposite[0].userId)
                            ],
                            avatars: [
                                items[0].avatarUrl,
                                opposite[0].avatarUrl
                            ],
                            createTime: Date.now()
                        };
                        var collection_pair = db.collection('pair');
                        collection_pair.insert(pairJson, function(err23, result3) { 
                            collection.update({_id: ObjectID(dateId)},{$set:{loveIds:loveIdArr, decidedIds:decidedIdArr, status:2}}, function(err231, result231) {  
                                collection.update({_id: ObjectID(matchId)},{$set:{status:2}}, function(err232, result232) {                   
                                    res.json({code: 2, msg: "匹配成功", data: [pairJson]});
                                    db.close();
                                });
                            });
                        });
                            
                    } else {
                        collection.update({_id: ObjectID(dateId)},{$set:{loveIds:loveIdArr, decidedIds:decidedIdArr}}, function(err22, result2) {                     
                            res.json({code: successCode, msg: "", data: result2});
                            db.close();
                        });
                    }
                });
            } else {           
                collection.update({_id: ObjectID(dateId)},{$set:{decidedIds:decidedIdArr}}, function(err3, result) {                     
                    res.json({code: successCode, msg: "", data: result});
                    db.close();
                });
            }
        });     
    });
});

app.get('/getpair', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");
    var id = req.query.id;

    MongoClient.connect(DB_CONN_STR, function(error, db) {
        console.log("getpair连接成功！");
        var collection = db.collection('pair');
        var collection_dates = db.collection('dates');
        collection.find({_id: ObjectID(id)}).toArray(function(err, arr){ 
            console.log(arr.length);
            collection_dates.find({_id: {"$in": arr[0]["pair"]}}).toArray(function(err1, items){        
                res.json({code: successCode, msg: "", data: items, msgList: arr[0]['msgList']});
                db.close();
            });
        });       
        
    });
}); 

app.post('/sendmsg', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");
    var id = req.body.id;
    var msgObj = {
        userId: req.body.userId,
        words: req.body.words,
        sendTime: Date.now()
    };
    MongoClient.connect(DB_CONN_STR, function(err, db) {
        console.log("sendmsg连接成功！");
        var collection = db.collection('pair');
        collection.find({_id: ObjectID(id)}).toArray(function(err, arr){ 
            var msgList = arr[0].msgList || [];
            msgList.push(msgObj);
            collection.update({_id: ObjectID(id)},{$set:{msgList:msgList}}, function(err1, result1) { 
                res.json({code: successCode, msg: "", data: msgObj}); 
                db.close();
            });
        });
    });
});

app.get('/receivemsg', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");
    var id = req.query.id;

    MongoClient.connect(DB_CONN_STR, function(error, db) {
        console.log("receivemsg连接成功！");
        var collection = db.collection('pair');
        collection.find({_id: ObjectID(id)},{msgList:1}).toArray(function(err, arr){ 
            res.json({code: successCode, msg: "", data: arr[0]['msgList']});
            db.close();
        });       
        
    });
}); 

app.post('/broadcast', function(req, res){
    var userId = req.body.userId,
        filmId = req.body.filmId+'';
    var dateInfo = {
        userId: userId,
        nickName: req.body.nickName,
        avatarUrl: req.body.avatarUrl,
        filmId: filmId,
        filmName: req.body.filmName,
        filmCover: req.body.filmCover,
        words: req.body.words,
        createTime: Date.now()
    };
    MongoClient.connect(DB_CONN_STR, function(err, db) {
        console.log("broadcast连接成功！");
        var collection = db.collection('broadcast');
        collection.find({userId:userId,filmId:filmId}).toArray(function(err1, items){ 
            if(items.length>0) {
                var broadcastId = items[0]._id;
                collection.update({_id: broadcastId},{$set:{words:req.body.words}}, function(err2, result1) { 
                    res.json({code: 1, msg: "", data: broadcastId}); 
                    db.close();
                });
            } else {
                collection.insert(dateInfo, function(err3, result2) { 
                    res.json({code: successCode, msg: "", data: result2.insertedIds[0]}); 
                    db.close();
                });
            }
        });
    });
});

app.get('/bcdetail', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");
    var id = req.query.id;

    MongoClient.connect(DB_CONN_STR, function(error, db) {
        console.log("broadcast连接成功！");
        var collection = db.collection('broadcast');
        collection.find({_id: ObjectID(id)}).toArray(function(err, items){   
            if(items.length>0) {  
                var willingUsers = items[0].willingUsers;
                if(willingUsers && willingUsers.length>0) {
                    var collection_user = db.collection('user');
                    collection_user.find({_id: {"$in": willingUsers}}, {_id:1,nickName:1,avatarUrl:1}).toArray(function(err1, items1){        
                        res.json({code: successCode, msg: "", data: items[0], userList: items1});
                        db.close();
                    });
                } else {
                    res.json({code: successCode, msg: "", data: items[0]});
                    db.close();
                }
            } else {
                res.json({code: failCode, data: '没找到'}); 
                db.close();
            }
        });              
    });
}); 


app.post('/willing', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");
    var id = req.body.id,
        userId = req.body.userId;

    MongoClient.connect(DB_CONN_STR, function(error, db) {
        console.log("broadcast连接成功！");
        var collection = db.collection('broadcast');
        collection.find({_id: ObjectID(id)}).toArray(function(err, items){            
            var willingArr = items[0].willingUsers || [];
            // var isExist = false;
            // for(var i=0,len=willingArr.length;i<len;i++) {
            //     if(willingArr[i] === userId){
            //         isExist = true;
            //         break;
            //     }
            // }
            // if(!isExist) {
                willingArr.push(ObjectID(userId));
                collection.update({_id: ObjectID(id)},{$set:{willingUsers:willingArr}}, function(err, result) { 
                    res.json({code: successCode, msg: "操作成功"});
                    db.close();
                });
            // } else {
            //     res.json({code: failCode, msg: "已表达过意愿"});
            //     db.close();
            // }
        });               
    });
}); 

/**
 * [breakfast] 天天晒早餐
 * @type {Object}
 */
app.get('/tGFrYeQFZG.txt', function(req, res){
    res.send('5dc88363851a7957e9616c47004dc67e');
});
var breakfastWXInfo = {
        appid: 'wx2992e5dce30736a9',
        secret: 'b2befe7883f36ddc7808c998b27158a0'
    };
app.get('/breakfast', function(req, res){
    res.send('<h1>天天晒早餐</h1>');
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
        collection.find({_id: ObjectID(userId)}).toArray(function(err, items){        
            if(items.length>0) {
                res.json({code: successCode, msg: "", data: items[0]});
            } else {
                res.json({code: failCode, data: '用户不存在'}); 
            }
            db.close();
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
        var result = yield client2.put(fileName, filePath);

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
        cookTime: Number(req.body.cookTime),
        forkCount: 0,
        fork_users: [],
        day: dayStr,
        createTime: now
    };
    if(userId === '5a3cd169165cea3cee830b11') {
        mealInfo.official = true;
    }
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

function inArray(search, arr) {
    arr.forEach(function(item){
        console.log(item);
        if(item === search){
            return true;
        }
    });
    if(arr.length>0){
        console.log(arr.length);
    }
    return false;
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
                        forkCount: item.forkCount,
                        day: item.day,
                        official: item.official
                    }
                    var forkUsers = item.fork_users;
                    if(inArray(userId,forkUsers)) {
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

var options = {
    key: fs.readFileSync('./keys/214248838510598.key'),
    cert: fs.readFileSync('./keys/214248838510598.pem')
};
https.createServer(options, app).listen(3000, function(req, res){
    console.log('server is running on port 3000');
});
