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
var DB_CONN_STR1 = 'mongodb://localhost:27017/wish';

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

/**
 * [weather] 天气预报
 *
 */

var weatherWXInfo = {
        appid: 'wxa161643780b58159',
        secret: '967d616ea68a37697c3a400d256e8cdd'
    };

app.get('/openid', function(req, res){
    var code = req.query.code;
    res.header("Content-Type", "application/json; charset=utf-8");

    superagent.get('https://api.weixin.qq.com/sns/jscode2session?appid='+weatherWXInfo.appid+'&secret='+weatherWXInfo.secret+'&js_code='+code+'&grant_type=authorization_code')
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
        open_id: req.query.openId,
        nick_name: req.query.nickName,
        gender: Number(req.query.gender),
        language: req.query.language,
        city: req.query.city,
        province: req.query.province,
        country: req.query.country,
        avatar_url: req.query.avatarUrl,
        create_time: Date.now()
    };
    MongoClient.connect(DB_CONN_STR1, function(err, db) {
        
        //执行插入数据操作
        var collection = db.collection('user');
        collection.find({open_id: userInfo.open_id}).toArray(function(err, items){        
            if(items.length > 0) {
                res.json({code: 1, msg: "", data: items[0]});

                //关闭数据库
                db.close();
            } else {

                //插入数据
                collection.insert(userInfo, function(error, result) { 
                    var fileName = result.insertedIds[0] + '.jpg';
                    var filePath = './uploads/avatar/' + fileName;
                    request(userInfo.avatar_url).pipe(fs.createWriteStream(filePath))
                    .on('close', function() {
                        co(function* () {
                            var stream = fs.createReadStream(filePath);
                            var result = yield client.putStream(fileName, stream);
                            fs.unlinkSync(filePath);
                        });
                    });

                    res.json({code: successCode, msg: "", data: result}); 
                    db.close();
                });
            }
        });
    });
});

app.get('/getforecast', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");
    var city = req.query.city;
    var nowdate = new Date(),
        date1 = nowdate.getDate(),
        hour = nowdate.getHours();

    if(hour >= 0 && hour < 6) {
        nowdate.setDate(date1 - 1);
    }

    var year = nowdate.getFullYear(),
        month = nowdate.getMonth()+1,
        date = nowdate.getDate(),
        dateStr = year+'/'+month+'/'+date;

    MongoClient.connect(DB_CONN_STR, function(err, db) {
        console.log("forecast连接成功！");
        var collection = db.collection('forecast');
        collection.findOne({city: city, date: dateStr}, function(err, item){   
            if(err) {
                res.json({code: failCode, data: err}); 
                db.close();
                return;
            }

            if(item) {
                res.json({code: 1, msg: "", data: item.daily_forecast});

                //关闭数据库
                db.close();
            } else {  
                superagent.get('https://free-api.heweather.com/s6/weather/forecast?location='+encodeURIComponent(city)+'&key=ef7860519dfb4062825fb1034fcb6690')
                .charset('utf-8')
                .end(function (err1, sres) {
                    if (err1) {
                        res.json({code: failCode, msg: err1});
                        return;
                    }

                    var dataJson = JSON.parse(sres.text),
                        weatherJson = dataJson.HeWeather6[0];

                    if(weatherJson.status === 'ok' && weatherJson.daily_forecast) {
                        weatherJson.city = city;
                        weatherJson.date = dateStr;

                        //插入数据
                        collection.insert(weatherJson, function(error, result) {                        
                            res.json({code: successCode, msg: "", data: weatherJson.daily_forecast}); 
                            db.close();
                        });
                    }
                });
            }
        });
    });                          
});

app.get('/getweatherinfo', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");

    // var lat = req.query.lat,
    //     lon = req.query.lon,
    var city = req.query.city,
        code = req.query.code;

    var nowdate = new Date(),
        date1 = nowdate.getDate(),
        hour = nowdate.getHours();

    if(hour >= 0 && hour < 6) {
        nowdate.setDate(date1 - 1);
    }

    var year = nowdate.getFullYear(),
        month = nowdate.getMonth()+1,
        date = nowdate.getDate(),
        dateStr = year+'/'+month+'/'+date;

    var weatherArr = {"暴雨":"10","大暴雨":"11","特大暴雨":"12","阵雪":"13","小雪":"14","中雪":"15","大雪":"16","暴雪":"17","雾":"18","冻雨":"19","沙尘暴":"20","小到中雨":"21","中到大雨":"22","大到暴雨":"23","暴雨到大暴雨":"24","大暴雨到特大暴雨":"25","小到中雪":"26","中到大雪":"27","大到暴雪":"28","浮尘":"29","扬沙":"30","强沙尘暴":"31","霾":"53","":"99","晴":"00","晴朗":"00","晴朗无云":"00","晴间多云":"00","大部晴朗":"00","多云":"01","大部多云":"01","局部多云":"01","阴":"02","阵雨":"03","雷阵雨":"04","雷阵雨伴有冰雹":"05","雨夹雪":"06","雨":"07","小雨":"07","中雨":"08","大雨":"09"};
    
    MongoClient.connect(DB_CONN_STR, function(err, db) {
        console.log("weather连接成功！");
        var collection = db.collection('weather');
        collection.findOne({city: city, date: dateStr}, function(err, item){   
            if(err) {
                res.json({code: failCode, data: err}); 
                db.close();
                return;
            }

            if(item) {
                if(city!=='杭州' || (city==='杭州' && item.correct)) {
                    res.json({code: 1, msg: "", data: item});

                    //关闭数据库
                    db.close();
                } else {
                    superagent.get('https://weather.com/zh-CN/weather/today/l/40639bc67e3f94d7b526b1f193abd84e915495768500bc80d878d14cd10d8338')
                    .charset('utf-8')
                    .end(function (err1, sres) {
                        if (err1) {
                            res.json({code: failCode, msg: err1});
                            return;
                        }

                        var $ = cheerio.load(sres.text);
                        var newItem = item,
                            weaTitle = $('#dp0-daypartName').text(),
                            newWeaText = $('#dp0-phrase').text(),
                            newWeaText = newWeaText.replace(/分地区/,'').replace(/地区/,''),
                            newWeaCode = weatherArr[newWeaText] || '00',
                            newTemp = $('#daypart-0 .today-daypart-temp span').text(),
                            newTemp = newTemp.replace(/°/,''),
                            newWeaText1 = $('#dp1-phrase').text(),
                            newWeaText1 = newWeaText1.replace(/分地区/,'').replace(/地区/,''),
                            newWeaCode1 = weatherArr[newWeaText1] || '00',
                            newTemp1 = $('#daypart-1 .today-daypart-temp span').text(),
                            newTemp1 = newTemp1.replace(/°/,'');

                        newItem.correct = 1;
                        newItem.updateTime = $('.today_nowcard-timestamp span').last().text();
                        if(weaTitle === '今天白天') {
                            newItem.dayWeather.weaText = newWeaText;
                            newItem.dayWeather.weaCode = 'd'+newWeaCode;
                            newItem.dayWeather.digitalCode = parseInt(newWeaCode);
                            newItem.dayWeather.temp = newTemp;
                            newItem.nightWeather.weaText = newWeaText1;
                            newItem.nightWeather.weaCode = 'n'+newWeaCode1;
                            newItem.nightWeather.digitalCode = parseInt(newWeaCode1);
                            newItem.nightWeather.temp = newTemp1;
                        } else {
                            newItem.nightWeather.weaText = newWeaText;
                            newItem.nightWeather.weaCode = 'n'+newWeaCode;
                            newItem.nightWeather.digitalCode = parseInt(newWeaCode);
                            newItem.nightWeather.temp = newTemp;
                        }

                        //插入数据
                        collection.update({_id: ObjectID(newItem._id)}, {$set:{correct:1,updateTime:newItem.updateTime,dayWeather:newItem.dayWeather,nightWeather:newItem.nightWeather}}, function(error, result) {                        
                            res.json({code: successCode, msg: "", data: newItem}); 
                            db.close();
                        });
                    });
                }
            } else {  
                superagent.get('http://www.weather.com.cn/weather1d/'+code+'.shtml')
                .charset('utf-8')
                .end(function (err1, sres) {
                    if (err1) {
                        res.json({code: failCode, msg: err1});
                        return;
                    }

                    var $ = cheerio.load(sres.text);
                    var updateTime = $('#update_time').val();
                    var insertJson = {
                        city: city,
                        date: dateStr,
                        updateTime: updateTime,
                        morningWeather: {
                            time: 'morning',
                            timeText: '早晨',
                            sunUp: ''
                        },
                        dayWeather: {},
                        eveningWeather: {
                            time: 'evening',
                            timeText: '傍晚',
                            sunDown: ''
                        },
                        nightWeather: {}
                    };

                    $('.t .clearfix li').each(function(idx, element) {
                        var $element = $(element),
                            title = $element.find('h1').text(),
                            // bigClass = $element.find('big').attr('class'),
                            weaText = $element.find('.wea').attr('title'),
                            weaCode = weatherArr[weaText],
                            temp = $element.find('.tem span').text(),
                            $win = $element.find('.win span'),
                            wind = [$win.attr('title'), $win.text()],
                            sky = $element.find('.sky .txt')[0] ? $element.find('.sky .txt').text() : '';

                        if(idx === 0) {
                            if(title.indexOf('白天') > -1) {
                                if($element.find('.sunUp span')[0]) {
                                    insertJson.morningWeather.sunUp = $element.find('.sunUp span').text();
                                }
                                insertJson.dayWeather = {
                                    time: 'day',
                                    timeText: '白天',
                                    weaCode: 'd'+weaCode,
                                    digitalCode: parseInt(weaCode),
                                    weaText: weaText,
                                    temp: temp,
                                    wind: wind,
                                    sky: sky
                                }
                            } else {
                                if($element.find('.sunDown span')[0]) {
                                    insertJson.eveningWeather.sunDown = $element.find('.sunDown span').text();
                                }
                                insertJson.nightWeather = {
                                    time: 'night',
                                    timeText: '晚上',
                                    weaCode: 'n'+weaCode,
                                    digitalCode: parseInt(weaCode),
                                    weaText: weaText,
                                    temp: temp,
                                    wind: wind,
                                    sky: sky
                                }
                            }
                        } else {
                            if(title.indexOf('夜间') > -1) {
                                if($element.find('.sunDown span')[0]) {
                                    insertJson.eveningWeather.sunDown = $element.find('.sunDown span').text();
                                }
                                insertJson.nightWeather = {
                                    time: 'night',
                                    timeText: '晚上',
                                    weaCode: 'n'+weaCode,
                                    digitalCode: parseInt(weaCode),
                                    weaText: weaText,
                                    temp: temp,
                                    wind: wind,
                                    sky: sky
                                }
                            }
                        }
                    });

                    if(new Date().getHours() < 18) {
                        var hour3dataText = $('#curve').next('script').text(),
                            hour3dataStr = hour3dataText.split('=')[1],
                            hour3data = JSON.parse(hour3dataStr),
                            hour3data1d =  hour3data['1d'],
                            morningData = hour3data1d[0],
                            dayData = hour3data1d[2],
                            eveningData = hour3data1d[3],
                            nightData = hour3data1d[5],
                            morningDataArr = morningData.split(','),
                            dayDataArr = dayData.split(','),
                            eveningDataArr = eveningData.split(','),
                            nightDataArr = nightData.split(',');

                        insertJson.morningWeather.weaCode = morningDataArr[1];
                        insertJson.morningWeather.digitalCode = parseInt(morningDataArr[1].substr(1));
                        insertJson.morningWeather.weaText = morningDataArr[2];
                        insertJson.morningWeather.temp = morningDataArr[3].replace(/℃/,'');
                        insertJson.morningWeather.wind = [morningDataArr[4], morningDataArr[5]];

                        insertJson.dayWeather.wind = [dayDataArr[4], dayDataArr[5]];
                       
                        insertJson.eveningWeather.weaCode = eveningDataArr[1];
                        insertJson.eveningWeather.digitalCode = parseInt(eveningDataArr[1].substr(1));
                        insertJson.eveningWeather.weaText = eveningDataArr[2];
                        insertJson.eveningWeather.temp = eveningDataArr[3].replace(/℃/,'');
                        insertJson.eveningWeather.wind = [eveningDataArr[4], eveningDataArr[5]];

                        insertJson.nightWeather.wind = [nightDataArr[4], nightDataArr[5]];
                    }               

                    //插入数据
                    collection.insert(insertJson, function(error, result) {                        
                        res.json({code: successCode, msg: "", data: insertJson}); 
                        db.close();
                    });
                });
            }
        });
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
        avatar_url: req.query.avatarUrl,
        create_time: Date.now()
    };
    MongoClient.connect(DB_CONN_STR, function(err, db) {
        console.log("adduser连接成功！");
        //执行插入数据操作
        var collection = db.collection('user');
        collection.find({open_id: userInfo.open_id}).toArray(function(err, items){        
            if(items.length > 0) {
                res.json({code: 1, msg: "", data: items[0]});

                //关闭数据库
                db.close();
            } else {

                //插入数据
                collection.insert(userInfo, function(error, result) { 
                    var fileName = result.insertedIds[0] + '.jpg';
                    var filePath = './uploads/avatar/' + fileName;
                    request(userInfo.avatar_url).pipe(fs.createWriteStream(filePath))
                    .on('close', function() {
                        co(function* () {
                            var stream = fs.createReadStream(filePath);
                            var result = yield client.putStream(fileName, stream);
                            fs.unlinkSync(filePath);
                        });
                    });

                    res.json({code: successCode, msg: "", data: result}); 
                    db.close();
                });
            }
        });
    });
});
// app.get('/getuseravatar', function(req, res){
//     MongoClient.connect(DB_CONN_STR, function(err, db) {
//         var userId = req.query.id;
//         var collection = db.collection('user');
//         collection.findOne({_id: ObjectID(userId)}, function(err, item){        
//             if(item) {               
//                 var fileName = userId + '.jpg';
//                 var filePath = './uploads/avatar/' + fileName;
//                 request(item.avatar_url).pipe(fs.createWriteStream(filePath))
//                 .on('close', function() {
//                     co(function* () {
//                         var stream = fs.createReadStream(filePath);
//                         var result = yield client.putStream(fileName, stream);
//                         fs.unlinkSync(filePath);
//                     });
//                 });

//                 res.json({code: successCode, msg: ""}); 
//                 db.close();
//             }
//         });
//     });
// });

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
        category: '年夜饭',
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
        var forkArr = [ObjectID("5a55e23cf248cb07dde095ae"),ObjectID("5a55e35df248cb07dde095af"),ObjectID("5a55e3a0f248cb07dde095b0"),ObjectID("5a55e4b8f248cb07dde095b1"),ObjectID("5a55e527f248cb07dde095b2"),ObjectID("5a55e58df248cb07dde095b3"),ObjectID("5a55e5bff248cb07dde095b4"),ObjectID("5a55e5e5f248cb07dde095b5"),ObjectID("5a55e61ef248cb07dde095b6"),ObjectID("5a55e624f248cb07dde095b7"),ObjectID("5a55e654f248cb07dde095b8"),ObjectID("5a55e68bf248cb07dde095b9"),ObjectID("5a55e6a5f248cb07dde095ba"),ObjectID("5a55e6d9f248cb07dde095bb"),ObjectID("5a55e710f248cb07dde095bc"),ObjectID("5a55e71af248cb07dde095bd"),ObjectID("5a55e76df248cb07dde095be"),ObjectID("5a55e76ef248cb07dde095bf"),ObjectID("5a55e785f248cb07dde095c0"),ObjectID("5a55e7dbf248cb07dde095c1"),ObjectID("5a55e7e2f248cb07dde095c2"),ObjectID("5a55e857f248cb07dde095c3"),ObjectID("5a55e8aaf248cb07dde095c4"),ObjectID("5a55e8aef248cb07dde095c5"),ObjectID("5a55e8c9f248cb07dde095c6"),ObjectID("5a55e90cf248cb07dde095c7"),ObjectID("5a55e92df248cb07dde095c8"),ObjectID("5a55e988f248cb07dde095c9"),ObjectID("5a55e9a5f248cb07dde095ca"),ObjectID("5a55ea37f248cb07dde095cb"),ObjectID("5a55ec15f248cb07dde095cd"),ObjectID("5a55ec71f248cb07dde095ce"),ObjectID("5a55ecadf248cb07dde095cf"),ObjectID("5a55ecbdf248cb07dde095d0"),ObjectID("5a55ed72f248cb07dde095d1"),ObjectID("5a55ee45f248cb07dde095d2"),ObjectID("5a55ee7ef248cb07dde095d3"),ObjectID("5a55ef71f248cb07dde095d4"),ObjectID("5a55f104f248cb07dde095d5"),ObjectID("5a55f10df248cb07dde095d6"),ObjectID("5a55f27df248cb07dde095d7"),ObjectID("5a55f2c7f248cb07dde095d8"),ObjectID("5a55f4b2f248cb07dde095d9"),ObjectID("5a55fc03f248cb07dde095da"),ObjectID("5a55fc86f248cb07dde095db"),ObjectID("5a55ff8ef248cb07dde095dc"),ObjectID("5a5602ccf248cb07dde095dd"),ObjectID("5a560636f248cb07dde095de"),ObjectID("5a560f97f248cb07dde095df"),ObjectID("5a5613b1f248cb07dde095e0"),ObjectID("5a56149af248cb07dde095e1"),ObjectID("5a5616b1f248cb07dde095e2"),ObjectID("5a561b51f248cb07dde095e3"),ObjectID("5a562489f248cb07dde095e4"),ObjectID("5a562676cb95993011184c5b"),ObjectID("5a56297fcb95993011184c5c"),ObjectID("5a562b0461453f0b51ae1ffb"),ObjectID("5a562d8061453f0b51ae1ffc"),ObjectID("5a563a3161453f0b51ae1ffd"),ObjectID("5a56455c61453f0b51ae1ffe"),ObjectID("5a569d0f61453f0b51ae1fff"),ObjectID("5a569faf61453f0b51ae2000"),ObjectID("5a56a3ca61453f0b51ae2001"),ObjectID("5a56c3ba61453f0b51ae2002"),ObjectID("5a56c4f161453f0b51ae2003"),ObjectID("5a5710bf61453f0b51ae2005"),ObjectID("5a57153261453f0b51ae2006"),ObjectID("5a57227161453f0b51ae2007"),ObjectID("5a5743aa61453f0b51ae2008"),ObjectID("5a57490f61453f0b51ae2009"),ObjectID("5a57493761453f0b51ae200a"),ObjectID("5a575c2561453f0b51ae200b"),ObjectID("5a57709861453f0b51ae200c"),ObjectID("5a5862ca3cf6913e6b30f5be"),ObjectID("5a58cc615fbc35086dd8bf74"),ObjectID("5a5980b49253cc21a60bc8c8"),ObjectID("5a5eb2acd3198d4269e2e454"),ObjectID("5a5ef4c5d3198d4269e2e455"),ObjectID("5a62e61333712218f89783fe"),ObjectID("5a63006a33712218f89783ff"),ObjectID("5a63030c33712218f8978400"),ObjectID("5a63046633712218f8978401"),ObjectID("5a632eef33712218f8978402"),ObjectID("5a6560186c41e6047e42a6d8"),ObjectID("5a6566766c41e6047e42a6d9"),ObjectID("5a6572dd6c41e6047e42a6da"),ObjectID("5a65794f6c41e6047e42a6db"),ObjectID("5a65f5726c41e6047e42a6dd"),ObjectID("5a66a19e6c41e6047e42a6e4"),ObjectID("5a66b11a6c41e6047e42a6e5"),ObjectID("5a68119ed7ddd13d1275ccd5"),ObjectID("5a68844ad7ddd13d1275ccd9"),ObjectID("5a688760d7ddd13d1275ccda"),ObjectID("5a692bbed7ddd13d1275ccdc"),ObjectID("5a697d6dd7ddd13d1275ccde"),ObjectID("5a69d60bd7ddd13d1275ccdf"),ObjectID("5a6afeaad0b76416e3f364c1"),ObjectID("5a6b3571d0b76416e3f364c2")];
        var order = Math.round(Math.random()*98);
        var forkUser = forkArr[order] || ObjectID("5a55e23cf248cb07dde095ae");
        collection.update({_id: ObjectID(id)}, {$set: {create_time: Date.now()}, $addToSet: {fork_users: forkUser}}, function(err1, item){        
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

app.get('/accesstoken', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");
       
    MongoClient.connect(DB_CONN_STR, function(err, db) {
        var collection = db.collection('wx');
        var requestNewToken = function(){
            superagent.get('https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid='+weatherWXInfo.appid+'&secret='+weatherWXInfo.secret)
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
                    res.json({code: 1, msg: "", data: items[0].access_token}); 
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

app.get('/qrcode', function(req, res){
    var accessToken = req.query.accessToken,
        id = req.query.id,
        path = 'pages/detail/detail?id='+id,
        width = Number(req.query.width);
    res.header("Content-Type", "application/json; charset=utf-8");
    var fileName = 'qrcode_'+id+'.png';
    var filePath = './uploads/qrcode/'+fileName;
    request({ 
        method: 'POST', 
        url: 'https://api.weixin.qq.com/wxa/getwxacode?access_token=' + accessToken, 
        body: JSON.stringify({path:path,width:width}) 
    }).pipe(fs.createWriteStream(filePath))
    .on('close', function() {
        var stat = fs.statSync(filePath);
        console.log('图片大小'+stat.size);
        cos.putObject({
            Bucket: 'zhishi-1255988328', 
            Region: 'ap-shanghai',
            Key: fileName, 
            ContentLength: stat.size,
            Body: fs.createReadStream(filePath)
        }, function (err, data) { 
            if(err) {
                res.json({code: failCode, data: err}); 
            } else {
                var qrcodeUrl = 'https://zhishi-1255988328.picsh.myqcloud.com/'+fileName;
                res.json({code: successCode, msg: "", data: qrcodeUrl}); 
                MongoClient.connect(DB_CONN_STR1, function(err, db) {
                    var collection = db.collection('wish');
                    collection.update({_id: ObjectID(id)}, {$set: {qrcode_url: qrcodeUrl}},  function(err1, item){                        
                        db.close();
                    });
                });
            }

            // 上传之后删除本地文件
            fs.unlinkSync(filePath);
        });
    });
});

app.post('/newwish', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");
    var userId = req.body.userId;
    var now = Date.now();

    var wishInfo = {
        user_id: userId,
        nick_name: req.body.nickName,
        wish: req.body.wish,
        city: req.body.city,
        planet: req.body.planet,
        fav_users: [],
        comments: [],
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

app.get('/wishdetail', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");

    var id = req.query.id;
    MongoClient.connect(DB_CONN_STR1, function(err, db) {
        var collection = db.collection('wish');
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

app.get('/wishlist', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");

    var pageNo = parseInt(req.query.pageNo);
    var userId = req.query.userId;
    var skipCount = (pageNo - 1) * 10;
    MongoClient.connect(DB_CONN_STR1, function(err, db) {
        var collection = db.collection('wish');
        collection.find({}, {nick_name:0}).sort({'create_time':-1}).limit(10).skip(skipCount).toArray(function(err, items){        
            if(items.length > 0) {
                var list = items;
                
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

var options = {
    key: fs.readFileSync('./keys/214248838510598.key'),
    cert: fs.readFileSync('./keys/214248838510598.pem')
};
https.createServer(options, app).listen(3000, function(req, res){
    console.log('server is running on port 3000');
});
