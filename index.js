var http = require('http');
var https = require('https');
var express = require('express');
var app = express();
var fs = require('fs');

// http.createServer(function(req,res){
//     res.writeHead(200,{'Content-Type': 'text/plain'});
//     res.end(JSON.stringify({userName:'helloWorld'}));
// }).listen(3389);

app.get('/tags', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");
    res.json({code: 1, msg: "asd", data: ''});
});

var options = {
	key: fs.readFileSync('./keys/214248838510598.key'),
	cert: fs.readFileSync('./keys/214248838510598.pem')
};
https.createServer(options, app).listen(3389, function(req, res){
    // res.writeHead(200);
    console.log('server is running on port 3389');
});
