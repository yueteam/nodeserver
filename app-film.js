var superagent = require('superagent');
var charset = require('superagent-charset');
charset(superagent);
var cheerio = require('cheerio');
var express = require('express');
var app = express();
var https = require('https');
var fs = require('fs');

var baseUrl = 'https://movie.douban.com';
const successCode = 0, failCode = -1;

function isEmpty(obj){
    for (var i in obj){
        return false;
    }
    return true;
}

app.get('/nowplaying', function(req, res){
    var city = req.query.city;
    var route = '/cinema/nowplaying/' + city + '/';
    res.header("Content-Type", "application/json; charset=utf-8");
    superagent.get(baseUrl+route)
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
    console.log('server is running on port 3000');
});
