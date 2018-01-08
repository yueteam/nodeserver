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
    bucket: 'breakfastcover'
});
// 引入json解析中间件
var bodyParser = require('body-parser');
// 添加json解析
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: false}));

var MongoClient = require('mongodb').MongoClient;
var ObjectID = require('mongodb').ObjectID;
var DB_CONN_STR = 'mongodb://localhost:27017/food'; 

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

app.get('/fdaccesstoken', function(req, res){
    var code = req.query.code;
    res.header("Content-Type", "application/json; charset=utf-8");
       
    MongoClient.connect(DB_CONN_STR, function(err, db) {
        var collection = db.collection('wx');
        var requestNewToken = function(){
            superagent.get('https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid'+foodWXInfo.appid+'&secret='+foodWXInfo.secret)
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
app.get('/fdqrcode', function(req, res){
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
        avatar_url: req.query.avatarUrl
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
        var result = yield client.put(fileName, filePath);

        // 上传之后删除本地文件
        fs.unlinkSync(filePath);

        res.send(result.url.replace(/http:/,'https:'));  
        db.close();
    }).catch(function (err) {
        console.log(err);
    }); 
})

app.get('/getnews1', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");

    var contentId = req.query.id;
    var tag = req.query.tag;
    MongoClient.connect(DB_CONN_STR, function(err, db) {       
        superagent.get('https://m.freshhema.com/json/getContentDetailById?contentId='+contentId+'&source=hema')
        .charset('utf-8')
        .end(function (err, sres) {
            if (err) {
                res.json({code: failCode, msg: err});
                return;
            }
            var resJson = JSON.parse(sres.text),
                title = resJson.result.contentBaseInfo.title,
                summary = resJson.result.contentBaseInfo.summary,
                cover = resJson.result.contentBaseInfo.cover.picUrl,
                coverW = resJson.result.contentBaseInfo.cover.picWidth,
                coverH = resJson.result.contentBaseInfo.cover.picHeight,
                resourceList = resJson.result.resourceInfo.resourceList;
            if(cover.substr(0,4)!=='http') {
                cover = 'https:'+cover;
            }
            var richContent = [];
            for(var i=0,len=resourceList.length;i<len;i++){
                var mod = resourceList[i];
                if(mod.picture) { // 图片
                    var picUrl = mod.picture.picUrl;
                    if(picUrl.substr(0,4)!=='http') {
                        picUrl = 'https:'+picUrl;
                    }
                    richContent.push({
                        type: 'picture',
                        pic_url: picUrl,
                        pic_width: mod.picture.picWidth,
                        pic_height: mod.picture.picHeight
                    });
                } else if(mod.resource) { // 文字
                    if(i>=len-3 && mod.style.textAlign==='right'){

                    }else{
                        var text = '';
                        for(var j=0,len1=mod.resource.length;j<len1;j++){
                            text += mod.resource[j].content;
                        }
                        if(text.indexOf('不得转载')===-1 && text.indexOf('华人健康网')===-1 && text.indexOf('吃的三次方')===-1 && text.indexOf('微信ID')===-1){
                        richContent.push({
                            type: 'text',
                            content: text
                        });
                        }
                    }
                } else if(mod.videoUrl) { // 视频
                    var videoUrl = mod.videoUrl,
                        videoCover = mod.videoCover.picUrl;
                    if(videoUrl.substr(0,4)!=='http') {
                        videoUrl = 'https:'+videoUrl;
                    }
                    if(videoCover.substr(0,4)!=='http') {
                        videoCover = 'https:'+videoCover;
                    }
                    richContent.push({
                        type: 'video',
                        video_url: videoUrl,
                        video_cover: videoCover
                    });
                }
            }
            var collection = db.collection('news');
            collection.insert({
                title: title,
                summary: summary,
                cover: {
                    cover_img: cover,
                    cover_width: coverW,
                    cover_height: coverH
                },
                tag: tag,
                rich_content: richContent,
                create_time: Date.now()
            }, function(error, result) { 
                res.json({code: successCode, msg: ""}); 
                db.close();
            });       
        });
    });

});
app.get('/getnews', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");

    var pageNo = parseInt(req.query.pageNo);
    var userId = req.query.userId;
    var skipCount = (pageNo-1)*20;
    MongoClient.connect(DB_CONN_STR, function(err, db) {
        var collection = db.collection('news');
        collection.find({}, {rich_content: 0}).sort({'create_time':-1}).limit(20).skip(skipCount).toArray(function(err, items){        
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

app.get('/shicai', function(req, res){
    // var city = req.query.city;
    // var route = 'http://www.meishichina.com/YuanLiao/category/rql/';
    // res.header("Content-Type", "application/json; charset=utf-8");
    // superagent.get(baseUrl+route)
    // .charset('utf-8')
    // .end(function (err, sres) {
    //     if (err) {
    //         console.log('ERR: ' + err);
    //         res.json({code: failCode, msg: err});
    //         return;
    //     }
    //     var $ = cheerio.load(sres.text);
    //     var filmJson = {},
    //         films = [];
    //     $('#nowplaying .lists .list-item').each(function (idx, element) {
    //         if(idx < 15) {
    //             var $element = $(element),
    //                 $poster = $element.find('.poster img');
    //             films.push({
    //                 id: $element.attr('id'),
    //                 img : $poster.attr('src'),
    //                 title : $element.data('title'),
    //                 score : $element.data('score'),
    //                 release: $element.data('release'),
    //                 duration: $element.data('duration'),
    //                 region: $element.data('region'),
    //                 director: $element.data('director'),
    //                 actors: $element.data('actors')
    //             });
    //         }
    //     }); 
    //     filmJson = {
    //         filmList: films,
    //         createTime: Date.now()
    //     };
        var scArr = [{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"zhu","category_sub_name":"猪肉","short_name":"ZhuRou","name":"猪肉"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"zhu","category_sub_name":"猪肉","short_name":"LiJi","name":"里脊"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"zhu","category_sub_name":"猪肉","short_name":"ZhuXiaoPai","name":"猪小排"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"zhu","category_sub_name":"猪肉","short_name":"ZhuDaPai","name":"猪大排"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"zhu","category_sub_name":"猪肉","short_name":"PaiGu","name":"排骨"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"zhu","category_sub_name":"猪肉","short_name":"ZhuTi","name":"猪蹄"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"zhu","category_sub_name":"猪肉","short_name":"ZhuDu","name":"猪肚"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"zhu","category_sub_name":"猪肉","short_name":"WuHuaRou","name":"五花肉"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"zhu","category_sub_name":"猪肉","short_name":"zhuXue","name":"猪血"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"zhu","category_sub_name":"猪肉","short_name":"ZhuPai","name":"猪排"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"zhu","category_sub_name":"猪肉","short_name":"ZhuJiao","name":"猪脚"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"zhu","category_sub_name":"猪肉","short_name":"ZhuGan","name":"猪肝"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"zhu","category_sub_name":"猪肉","short_name":"ZhuYao","name":"猪腰"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"zhu","category_sub_name":"猪肉","short_name":"ZiPai","name":"子排"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"zhu","category_sub_name":"猪肉","short_name":"ZhuZhou","name":"猪肘"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"zhu","category_sub_name":"猪肉","short_name":"ZhuXin","name":"猪心"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"zhu","category_sub_name":"猪肉","short_name":"ZhuXiaoChang","name":"猪小肠"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"zhu","category_sub_name":"猪肉","short_name":"ZhuWei","name":"猪尾巴"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"zhu","category_sub_name":"猪肉","short_name":"ZhuEr","name":"猪耳"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"zhu","category_sub_name":"猪肉","short_name":"ZhuRouPi","name":"猪皮"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"zhu","category_sub_name":"猪肉","short_name":"ZhuShe","name":"猪舌"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"zhu","category_sub_name":"猪肉","short_name":"ZhuGuTou","name":"猪骨头"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"zhu","category_sub_name":"猪肉","short_name":"ZhuYi","name":"猪胰"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"zhu","category_sub_name":"猪肉","short_name":"ZhuTui","name":"猪腿"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"zhu","category_sub_name":"猪肉","short_name":"LongGu","name":"龙骨"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"zhu","category_sub_name":"猪肉","short_name":"LeiPai","name":"肋排"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"zhu","category_sub_name":"猪肉","short_name":"HouTuiRou","name":"后腿肉"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"zhu","category_sub_name":"猪肉","short_name":"BangGu","name":"棒骨"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"zhu","category_sub_name":"猪肉","short_name":"QiangGu","name":"腔骨"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"zhu","category_sub_name":"猪肉","short_name":"ZhuTouRou","name":"猪头肉"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"zhu","category_sub_name":"猪肉","short_name":"ZhuFei","name":"猪肺"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"zhu","category_sub_name":"猪肉","short_name":"ZhuDaGu","name":"猪大骨"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"zhu","category_sub_name":"猪肉","short_name":"ZhuTiJin","name":"猪蹄筋"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"zhu","category_sub_name":"猪肉","short_name":"ZhuJian","name":"猪腱"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"zhu","category_sub_name":"猪肉","short_name":"ZhuHouTuiRou","name":"猪后腿肉"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"zhu","category_sub_name":"猪肉","short_name":"ZhuDaChang","name":"猪大肠"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"zhu","category_sub_name":"猪肉","short_name":"RouMo","name":"肉末"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"zhu","category_sub_name":"猪肉","short_name":"ZhuLiJi","name":"猪里脊"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"zhu","category_sub_name":"猪肉","short_name":"ZhuJingRou","name":"猪颈肉"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"zhu","category_sub_name":"猪肉","short_name":"ZhuFeiChang","name":"猪肥肠"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"zhu","category_sub_name":"猪肉","short_name":"QianTunJian","name":"前臀尖"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"zhu","category_sub_name":"猪肉","short_name":"HouTunJian","name":"后臀尖"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"zhu","category_sub_name":"猪肉","short_name":"ZhuNao","name":"猪脑"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"zhu","category_sub_name":"猪肉","short_name":"XiaoLiJiRou","name":"小里脊肉"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"zhu","category_sub_name":"猪肉","short_name":"ZhuWuHuaNan","name":"猪五花腩"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"zhu","category_sub_name":"猪肉","short_name":"YeZhuRou","name":"野猪肉"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"zhu","category_sub_name":"猪肉","short_name":"ZhuLongGu","name":"猪龙骨"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"zhu","category_sub_name":"猪肉","short_name":"ZhuJiaXinRouRou","name":"猪胛心肉"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"zhu","category_sub_name":"猪肉","short_name":"ZhuJiaRou","name":"猪颊肉"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"zhu","category_sub_name":"猪肉","short_name":"ZhuTianTi","name":"猪天梯"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"zhu","category_sub_name":"猪肉","short_name":"ZhuZuiBianRou","name":"猪嘴边肉"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"zhu","category_sub_name":"猪肉","short_name":"FeiBiaoRou","name":"肥膘肉"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"zhu","category_sub_name":"猪肉","short_name":"FeiRou","name":"肥肉"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"zhu","category_sub_name":"猪肉","short_name":"ShouRou","name":"瘦肉"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"zhu","category_sub_name":"猪肉","short_name":"RouXian","name":"肉馅"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"zhu","category_sub_name":"猪肉","short_name":"ZhuJiaXinRou","name":"猪夹心肉"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"zhu","category_sub_name":"猪肉","short_name":"ZhuTongGu","name":"猪筒骨"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"zhu","category_sub_name":"猪肉","short_name":"ZhuQianJiaRou","name":"猪前夹肉"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"zhu","category_sub_name":"猪肉","short_name":"QianTuiRou","name":"前腿肉"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"zhu","category_sub_name":"猪肉","short_name":"ZhuShanGu","name":"猪扇骨"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"zhu","category_sub_name":"猪肉","short_name":"ZhuPi","name":"猪脾"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"zhu","category_sub_name":"猪肉","short_name":"MeiHuaRou","name":"梅花肉"}];
        MongoClient.connect(DB_CONN_STR, function(err, db) {
            var collection = db.collection('shicai');

            //插入数据
            collection.insertMany(scArr, function(error, result) { 
                res.json({code: successCode, msg: "", data: result}); 
                db.close();
            });
        }); 
    // });
});
// var $categorySub = $('.category_sub').eq(0).find('a');
// var arr = [];
// $categorySub.each(function(index,item){
//     var url = $(item).attr('href');
//     var reg = new RegExp('YuanLiao/([^/]+)');
//     var match = url.match(reg);
//     arr.push({
//         category_id: 'rqd',
//         category_name: '肉禽蛋',
//         category_sub_id: 'zhu',
//         category_sub_name: '猪肉',
//         short_name: match[1],
//         name: $(item).attr('title')
//     });
// });
// console.log(JSON.stringify(arr));

var options = {
    key: fs.readFileSync('./keys/214248838510598.key'),
    cert: fs.readFileSync('./keys/214248838510598.pem')
};
https.createServer(options, app).listen(3000, function(req, res){
    console.log('server is running on port 3000');
});
