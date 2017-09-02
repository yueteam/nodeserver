var https = require('https');

https.createServer(function(req,res){
    res.writeHead(200,{'Content-Type': 'text/plain'});
    res.end(JSON.stringify({userName:'helloWorld'}));
}).listen(3389);

console.log('server is running on port 3389');
