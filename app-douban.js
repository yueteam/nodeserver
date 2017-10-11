var superagent = require('superagent');
var charset = require('superagent-charset');
charset(superagent);
var cheerio = require('cheerio');
var express = require('express');
var app = express();
var https = require('https');
var fs = require('fs');

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
    res.send('<h1>girls now!</h1>');
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
        var items = [];
        if (err) {
            console.log('ERR: ' + err);
            res.json({code: failCode, msg: err, sets:items});
            return;
        }
        var $ = cheerio.load(sres.text);
        $('#nowplaying .lists .list-item').each(function (idx, element) {
            if(idx < 15) {
                var $element = $(element),
                    $poster = $element.find('.poster img');
                items.push({
                    img : $poster.attr('src'),
                    title : $element.data('title'),
                    rate : $element.data('score')
                });
            }
        });
        res.json({code: successCode, msg: "", data:items});
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
