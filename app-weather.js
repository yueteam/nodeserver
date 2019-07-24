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
var weatherKey = '38c28df6f387474c977cbb17a7b20fa4';
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
                    if(userInfo.avatar_url) {
                        request(userInfo.avatar_url).pipe(fs.createWriteStream(filePath))
                        .on('close', function() {
                            co(function* () {
                                var stream = fs.createReadStream(filePath);
                                var result = yield client.putStream(fileName, stream);
                                fs.unlinkSync(filePath);
                            });
                        });
                    }

                    res.json({code: successCode, msg: "", data: result});
                    db.close();
                });
            }
        });
    });
});

app.get('/getweather', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");
    var city = req.query.city;
    var nowdate = new Date(),
        year = nowdate.getFullYear(),
        month = nowdate.getMonth()+1,
        date = nowdate.getDate(),
        hm = nowdate.getHours()+0.01*nowdate.getMinutes();

    var dateStr = year+'/'+month+'/'+date;
    var nightMode = false;

    MongoClient.connect(DB_CONN_STR1, function(err, db) {
        console.log("weather连接成功！");
        var collection = db.collection('weather');
        collection.findOne({city: city, date: dateStr}, function(err, item){
            if(err) {
                res.json({code: failCode, data: err});
                db.close();
                return;
            }

            if(item) {
                let nowTime = Date.now();
                var loc = item.update.loc;
                loc = loc.replace(/-/g, '/');
                var locTime = new Date(loc).getTime();
                if(nowTime - locTime > 1.07*60*60*1000) {
                    superagent.get('https://free-api.heweather.com/s6/weather?location='+encodeURIComponent(city)+'&key='+weatherKey)
                    .charset('utf-8')
                    .end(function (err1, sres) {
                        if (err1) {
                            res.json({code: failCode, msg: err1});
                            return;
                        }
                        var dataJson = JSON.parse(sres.text),
                            weatherJson = dataJson.HeWeather6[0];

                        if(weatherJson.status === 'ok') {
                            var sr = weatherJson.daily_forecast[0].sr,
                                srNum = Number(sr.replace(/:/,'.')),
                                ss = weatherJson.daily_forecast[0].ss,
                                ssNum = Number(ss.replace(/:/,'.'));
                            if(hm > ssNum || hm < srNum) {
                                nightMode = true;
                            }

                            //更新数据
                            collection.update({_id: item._id}, {$set: {now: weatherJson.now, daily_forecast: weatherJson.daily_forecast, hourly: weatherJson.hourly, update: weatherJson.update}}, function(error, result) {
                                res.json({code: successCode, msg: "", data: {id: item._id, nightMode: nightMode, update: weatherJson.update, now: weatherJson.now, daily: weatherJson.daily_forecast[0], hourly: weatherJson.hourly}});
                                db.close();
                            });
                        }
                    });
                } else {
                    var sr = item.daily_forecast[0].sr,
                        srNum = Number(sr.replace(/:/,'.')),
                        ss = item.daily_forecast[0].ss,
                        ssNum = Number(ss.replace(/:/,'.'));
                    if(hm > ssNum || hm < srNum) {
                        nightMode = true;
                    }
                    res.json({code: 1, msg: "", data: {id: item._id, nightMode: nightMode, update: item.update, air: item.air||'', now: item.now, daily: item.daily_forecast[0], hourly: item.hourly}});

                    //关闭数据库
                    db.close();
                }
            } else {
                superagent.get('https://free-api.heweather.com/s6/weather?location='+encodeURIComponent(city)+'&key='+weatherKey)
                .charset('utf-8')
                .end(function (err1, sres) {
                    if (err1) {
                        res.json({code: failCode, msg: err1});
                        return;
                    }

                    var dataJson = JSON.parse(sres.text),
                        weatherJson = dataJson.HeWeather6[0];

                    if(weatherJson.status === 'ok') {
                        weatherJson.city = city;
                        weatherJson.date = dateStr;
                        weatherJson.create_time = Date.now();
                        var sr = weatherJson.daily_forecast[0].sr,
                            srNum = Number(sr.replace(/:/,'.')),
                            ss = weatherJson.daily_forecast[0].ss,
                            ssNum = Number(ss.replace(/:/,'.'));
                        if(hm > ssNum || hm < srNum) {
                            nightMode = true;
                        }

                        //插入数据
                        collection.insert(weatherJson, function(error, result) {
                            res.json({code: successCode, msg: "", data: {id: result.insertedIds[0], nightMode: nightMode, update: weatherJson.update, now: weatherJson.now, daily: weatherJson.daily_forecast[0], hourly: weatherJson.hourly}});
                            db.close();
                        });
                    }
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
                let nowTime = Date.now();
                var loc = item.update.loc;
                loc = loc.replace(/-/g, '/');
                var locTime = new Date(loc).getTime();
                if(nowTime - locTime > 3*60*60*1000) {
                    superagent.get('https://free-api.heweather.com/s6/weather/forecast?location='+encodeURIComponent(city)+'&key='+weatherKey)
                    .charset('utf-8')
                    .end(function (err1, sres) {
                        if (err1) {
                            res.json({code: failCode, msg: err1});
                            return;
                        }

                        var dataJson = JSON.parse(sres.text),
                            weatherJson = dataJson.HeWeather6[0];

                        if(weatherJson.status === 'ok' && weatherJson.daily_forecast) {

                            //更新数据
                            collection.update({_id: item._id}, {$set: {daily_forecast: weatherJson.daily_forecast, update: weatherJson.update}}, function(error, result) {
                                res.json({code: successCode, msg: "", data: weatherJson.daily_forecast, update: weatherJson.update});
                                db.close();
                            });
                        }
                    });
                } else {
                    res.json({code: 1, msg: "", data: item.daily_forecast, update: item.update});

                    //关闭数据库
                    db.close();
                }
            } else {
                superagent.get('https://free-api.heweather.com/s6/weather/forecast?location='+encodeURIComponent(city)+'&key='+weatherKey)
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
                        weatherJson.create_time = Date.now();

                        //插入数据
                        collection.insert(weatherJson, function(error, result) {
                            res.json({code: successCode, msg: "", data: weatherJson.daily_forecast, update: weatherJson.update});
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

    var city = req.query.city,
        code = req.query.code;

    var nowdate = new Date(),
        date1 = nowdate.getDate(),
        hour = nowdate.getHours(),
        minute = nowdate.getMinutes();

    if(hour >= 0 && hour < 6) {
        nowdate.setDate(date1 - 1);
    }

    var nightMode = false;
    if((hour >= 18 && hour <= 23) || (hour >= 0 && hour < 6)) {
        nightMode = true;
    }

    var year = nowdate.getFullYear(),
        month = nowdate.getMonth()+1,
        date = nowdate.getDate(),
        dateStr = year+'/'+month+'/'+date;

    var weatherArr = {"暴雨":"10","大暴雨":"11","特大暴雨":"12","阵雪":"13","小雪":"14","中雪":"15","大雪":"16","暴雪":"17","雾":"18","冻雨":"19","沙尘暴":"20","小到中雨":"21","中到大雨":"22","大到暴雨":"23","暴雨到大暴雨":"24","大暴雨到特大暴雨":"25","小到中雪":"26","中到大雪":"27","大到暴雪":"28","浮尘":"29","扬沙":"30","强沙尘暴":"31","霾":"53","":"99","晴":"00","晴朗":"00","晴朗无云":"00","晴间多云":"00","大部晴朗":"00","多云":"01","大部多云":"01","局部多云":"01","阴":"02","阵雨":"03","雷阵雨":"04","雷阵雨伴有冰雹":"05","雨夹雪":"06","雨":"07","小雨":"07","中雨":"08","大雨":"09"};

    MongoClient.connect(DB_CONN_STR, function(err, db) {
        console.log("weather连接成功！");
        var collection = db.collection('weather');
        collection.find({city: city, date: dateStr}).sort({'create_time':-1}).limit(1).toArray(function(err, items){
            if(err) {
                res.json({code: failCode, data: err});
                db.close();
                return;
            }

            var updated = false;
            if(items.length > 0) {
                var item = items[0];
                var lastUpdateTime = item.updateTime;
                var nowTimeNum = parseInt(hour) + parseInt(minute)*0.01;
                if((lastUpdateTime === '05:30' && nowTimeNum < 7.35) || (lastUpdateTime === '07:30' && nowTimeNum < 11.35) || (lastUpdateTime === '11:30' && nowTimeNum < 18.05) || lastUpdateTime === '18:00') {
                    updated = true;
                } else {
                    // collection.remove({city: city, date: dateStr});
                }
            }

            if(updated) {
                res.json({code: 1, msg: "", data: item});

                //关闭数据库
                db.close();

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
                        nightMode: nightMode,
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
                        nightWeather: {},
                        create_time: Date.now()
                    };

                    $('.t .clearfix li').each(function(idx, element) {
                        var $element = $(element);
                        if($element.find('h1')[0]) {
                            var title = $element.find('h1').text(),
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
                                        timeText: '夜间',
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
                                        timeText: '夜间',
                                        weaCode: 'n'+weaCode,
                                        digitalCode: parseInt(weaCode),
                                        weaText: weaText,
                                        temp: temp,
                                        wind: wind,
                                        sky: sky
                                    }
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

app.get('/getair', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");
    var id = req.query.id,
        city = req.query.city;

    MongoClient.connect(DB_CONN_STR1, function(err, db) {
        var collection = db.collection('weather');

        superagent.get('https://free-api.heweather.com/s6/air/now?location='+encodeURIComponent(city)+'&key='+weatherKey)
        .charset('utf-8')
        .end(function (err1, sres) {
            if (err1) {
                res.json({code: failCode, msg: err1});
                return;
            }
            var dataJson = JSON.parse(sres.text),
                airJson = dataJson.HeWeather6[0];

            if(airJson.status === 'ok') {
                var airData = {
                    air_now_city: airJson.air_now_city,
                    update: airJson.update
                };
                collection.update({_id: ObjectID(id)}, {$set:{air: airData}}, function(error, result) {
                    res.json({code: successCode, msg: "", data: airData});
                    db.close();
                });
            }
        });
    });
});

app.get('/getnow', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");
    var id = req.query.id,
        city = req.query.city;

    MongoClient.connect(DB_CONN_STR, function(err, db) {
        var collection = db.collection('weather');

        superagent.get('https://free-api.heweather.com/s6/weather/now?location='+encodeURIComponent(city)+'&key='+weatherKey)
        .charset('utf-8')
        .end(function (err1, sres) {
            if (err1) {
                res.json({code: failCode, msg: err1});
                return;
            }

            var dataJson = JSON.parse(sres.text),
                nowJson = dataJson.HeWeather6[0];

            if(nowJson.status === 'ok' && nowJson.now) {
                var nowData = {
                    now: nowJson.now,
                    update: nowJson.update
                };
                collection.update({_id: ObjectID(id)}, {$set:{nowWeather: nowData}}, function(error, result) {
                    res.json({code: successCode, msg: "", data: nowData});
                    db.close();
                });
            }
        });
    });
});

app.get('/getsound', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");

    MongoClient.connect(DB_CONN_STR1, function(err, db) {
        var collection = db.collection('sound');
        collection.findOne({_id: ObjectID('5ab9f3fa8f465b275bd77fcd')}, function(err1, item){
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
