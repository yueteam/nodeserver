var https = require('https');

https.createServer(function(req,res){
    res.writeHead(200,{'Content-Type': 'text/plain'});
    res.end(JSON.stringify({userName:'helloWorld'}));
}).listen(6001);

console.log('server is running on port 6001');
