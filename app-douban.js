var superagent = require('superagent');
var charset = require('superagent-charset');
charset(superagent);
var cheerio = require('cheerio');
var express = require('express');
var app = express();
var https = require('https');
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
// 引入json解析中间件
var bodyParser = require('body-parser');
// 添加json解析
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: false}));

var MongoClient = require('mongodb').MongoClient;
var ObjectID = require('mongodb').ObjectID;
var DB_CONN_STR = 'mongodb://localhost:27017/yue'; 

var baseUrl = 'http://www.dbmeinv.com';
var baseUrl1 = 'https://movie.douban.com';
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

app.get('/', function(req, res){
    res.send('<h1>约吗？</h1>');
});

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

app.get('/nowplaying', function(req, res){
    var city = req.query.city;
    var route = '/cinema/nowplaying/' + city + '/';
    res.header("Content-Type", "application/json; charset=utf-8");
    superagent.get(baseUrl1+route)
    .charset('utf-8')
    .end(function (err, sres) {
        if (err) {
            console.log('ERR: ' + err);
            res.json({code: failCode, msg: err});
            return;
        }
        var $ = cheerio.load(sres.text);
        var dataObj = {},
            films = [],
            districts = [];
        $('#nowplaying .lists .list-item').each(function (idx, element) {
            if(idx < 15) {
                var $element = $(element),
                    $poster = $element.find('.poster img');
                films.push({
                    id: $element.attr('id'),
                    img : $poster.attr('src'),
                    title : $element.data('title'),
                    rate : $element.data('score'),
                    release: $element.data('release'),
                    duration: $element.data('duration'),
                    region: $element.data('region'),
                    director: $element.data('director'),
                    actors: $element.data('actors')
                });
            }
        });
        dataObj.filmList = films;

        try{      
            dataObj.cityInfo = {
                id: $('#location').data('id'),
                uid: $('#location').data('uid'),
                name: $('#hd .page-title').text().split(' - ')[1]
            }
        } catch(e){}

        $('#districts .district-item').each(function (idx, element) {
            var $element = $(element);
            districts.push({
                id: $element.attr('id'),
                name: $element.text()
            });
        });
        dataObj.districtList = districts;
        
        res.json({code: successCode, msg: "", data: dataObj});
    });
});

app.get('/getcinemas', function(req, res){
    var cityId = req.query.cityId;
    var districtId = req.query.districtId;
    res.header("Content-Type", "application/json; charset=utf-8");

    superagent.get('https://movie.douban.com/j/cinema/cinemas/?city_id='+cityId+'&district_id='+districtId)
    .charset('utf-8')
    .end(function (err, sres) {
        if (err) {
            res.json({code: failCode, msg: err});
            return;
        }
        var list = JSON.parse(sres.text);
        res.json({code: successCode, msg: "", data: list});        
    });

});

app.get('/citys', function(req, res){
    var route = '';
    res.header("Content-Type", "application/json; charset=utf-8");
    superagent.get(baseUrl1+route)
    .charset('utf-8')
    .end(function (err, sres) {
        if (err) {
            console.log('ERR: ' + err);
            res.json({code: failCode, msg: err});
            return;
        }
        var $ = cheerio.load(sres.text);

        var cityObj = {};
        $('#cities-list .city-mod').each(function (idx, element) {
            var $element = $(element);
            var $cityItem = $element.find('.city-item');
            var letter = $element.find('dt').text();
            cityObj[letter] = [];
            $cityItem.each(function (i, ele) {
                var $ele = $(ele);
                cityObj[letter].push({
                    id: $ele.attr('id'),
                    uid: $ele.attr('uid'),
                    name: $ele.text()
                });
            });
        });
        res.json({code: successCode, msg: "", data: cityObj});
    });
});
app.get('/getdistrict', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");
    
    var cityId = req.query.id,
        cityUid = req.query.uid,
        cityName = req.query.name;
    cityObj = {
        id: cityId,
        uid: cityUid,
        name: cityName
    };
    var route = 'https://www.douban.com/location/'+cityUid+'/events/weekend-1803';
    superagent.get(route)
    .charset('utf-8')
    .end(function (err, sres) {
        if (err) {
            console.log('ERR: ' + err);
            res.json({code: failCode, msg: err});
            return;
        }
        var $ = cheerio.load(sres.text);

        var districtArr = [];
        $('.ui-fbox a').each(function (idx, element) {
            var $element = $(element);
            var href = $element.attr('href');
            var districtId = href.substring(href.lastIndexOf('-')+1);
            var districtName = $element.text().replace(/\\n/g,'').replace(/^(\s|\u00A0)+/,'').replace(/(\s|\u00A0)+$/,'');
            if(districtName!=='全部'){
                districtArr.push({
                    id: districtId,
                    name: districtName
                })
            }
        });
        cityObj.district = districtArr;

        MongoClient.connect(DB_CONN_STR, function(err, db) {
            var collection = db.collection('city');

            //插入数据
            collection.insert(cityObj, function(error, result) { 
                res.json({code: successCode, msg: "", data: result}); 
                db.close();
            });
        });
        
    });
    
});

app.get('/getopenid', function(req, res){
    var code = req.query.code;
    res.header("Content-Type", "application/json; charset=utf-8");

    superagent.get('https://api.weixin.qq.com/sns/jscode2session?appid=wx288b9aa48204f09c&secret=7f0d2d16a6d82ddb3fd3ade56bc23712&js_code='+code+'&grant_type=authorization_code')
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
    // 图片重命名
    // fs.rename(filePath, './uploads/' + fileName, (err) => {
    //     if (err) { 
    //         res.json({code: failCode, data: '文件写入失败'});  
    //     }else{
            
        // }
    // });
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
    if(districtId !== 'all') {
        orArr.push({districtId:'all'});
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

var options = {
	key: fs.readFileSync('./keys/214248838510598.key'),
	cert: fs.readFileSync('./keys/214248838510598.pem')
};
https.createServer(options, app).listen(3000, function(req, res){
    // res.writeHead(200);
    console.log('server is running on port 3000');
});
