var superagent = require('superagent');
var charset = require('superagent-charset');
charset(superagent);
var cheerio = require('cheerio');
var express = require('express');
var app = express();
var https = require('https');
var fs = require('fs');
// 引入json解析中间件
var bodyParser = require('body-parser');
// 添加json解析
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: false}));

var MongoClient = require('mongodb').MongoClient;
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

var insertUser = function(data, db, callback) {  

    //获得指定的集合 
    var collection = db.collection('user');

    collection.find({"openId":data.openId}).toArray(function(err, items){        
        if(items.length>0) {
            callback('用户已存在');
        } else {

            //插入数据
            collection.insert(data, function(err, result) { 
                //如果存在错误
                if(err) {
                    console.log('Error:'+ err);
                    return;
                } 
                //调用传入的回调方法，将操作结果返回
                callback(result);
            });
        }
    });
}

app.get('/adduser', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");
    var userInfo = {
        openId: req.query.openId,
        nickName: req.query.nickName,
        gender: req.query.gender,
        language: req.query.language,
        city: req.query.city,
        province: req.query.province,
        country: req.query.country,
        avatarUrl: req.query.avatarUrl
    };
    MongoClient.connect(DB_CONN_STR, function(err, db) {
        console.log("连接成功！");
        //执行插入数据操作，调用自定义方法
        insertUser(userInfo, db, function(result) {
            //显示结果
            res.json({code: successCode, msg: "", data: result}); 
            //关闭数据库
            db.close();
        });
    });
});
app.post('/saveuserinfo', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");
    var openId = req.body.openId,
        updateInfo = {
            nickName: req.body.nickName,
            gender: req.body.gender,
            birthday: req.body.birthday,
            personality: req.body.personality,  
            business: req.body.business,  
            company: req.body.company,  
            profession: req.body.profession           
        };
    MongoClient.connect(DB_CONN_STR, function(err, db) {
        console.log("db连接成功！");
        var collection = db.collection('user');
        collection.update({'openId':openId},{$set:updateInfo}, function(err, result) { 
            //如果存在错误
            if(err) {
                console.log('Error:'+ err);
                res.json({code: failCode, data: err}); 
                db.close();
                return;
            } 
            res.json({code: successCode, msg: "", data: result}); 
            db.close();
        });
    });
});

app.post('/pubdate', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");
    var dateInfo = {
        userId: req.body.userId,
        nickName: req.body.nickName,
        gender: req.body.gender,
        avatarUrl: req.body.avatarUrl,
        filmId: req.body.filmId,
        filmName: req.body.filmName,
        cityId: req.body.cityId,
        cityName: req.body.cityName,
        day: req.body.day,
        time: req.body.time,
        districtId: req.body.districtId,
        districtName: req.body.districtName,
        cinemaId: req.body.cinemaId,
        cinemaName: req.body.cinemaName,
        cinemaAddress: req.body.cinemaAddress,
        words: req.body.words,
        status: 0, // 0未匹配 1匹配中 2匹配成功
        createTime: Date.now().toString()
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
