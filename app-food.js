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
        var scArr = [{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"niu","category_sub_name":"牛肉","short_name":"NiuRou","name":"牛肉"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"niu","category_sub_name":"牛肉","short_name":"NiuNan","name":"牛腩"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"niu","category_sub_name":"牛肉","short_name":"NiuPai","name":"牛排"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"niu","category_sub_name":"牛肉","short_name":"NiuZa","name":"牛杂"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"niu","category_sub_name":"牛肉","short_name":"NiuXin","name":"牛心"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"niu","category_sub_name":"牛肉","short_name":"NiuWei","name":"牛尾"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"niu","category_sub_name":"牛肉","short_name":"NiuTuiRou","name":"牛腿肉"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"niu","category_sub_name":"牛肉","short_name":"NiuTiJin","name":"牛蹄筋"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"niu","category_sub_name":"牛肉","short_name":"NiuTi","name":"牛蹄"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"niu","category_sub_name":"牛肉","short_name":"NiuShe","name":"牛舌"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"niu","category_sub_name":"牛肉","short_name":"NiuNao","name":"牛脑"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"niu","category_sub_name":"牛肉","short_name":"NiuLiJi","name":"牛里脊"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"niu","category_sub_name":"牛肉","short_name":"NiuJin","name":"牛筋"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"niu","category_sub_name":"牛肉","short_name":"NiuJianZi","name":"牛腱子"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"niu","category_sub_name":"牛肉","short_name":"NiuGuSui","name":"牛骨髓"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"niu","category_sub_name":"牛肉","short_name":"NiuGu","name":"牛骨"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"niu","category_sub_name":"牛肉","short_name":"NiuGan","name":"牛肝"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"niu","category_sub_name":"牛肉","short_name":"NiuDu","name":"牛肚"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"niu","category_sub_name":"牛肉","short_name":"NiuBian","name":"牛鞭"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"niu","category_sub_name":"牛肉","short_name":"NiuBaiYe","name":"牛百叶"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"niu","category_sub_name":"牛肉","short_name":"NiuZaiGu","name":"牛仔骨"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"niu","category_sub_name":"牛肉","short_name":"FeiNiu","name":"肥牛"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"niu","category_sub_name":"牛肉","short_name":"NiuShangNao","name":"牛上脑"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"niu","category_sub_name":"牛肉","short_name":"NiuJianZiRou","name":"牛腱子肉"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"niu","category_sub_name":"牛肉","short_name":"NiuLeiGu","name":"牛肋骨"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"niu","category_sub_name":"牛肉","short_name":"NiuTouPi","name":"牛头皮"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"niu","category_sub_name":"牛肉","short_name":"NiuXiGaiGu","name":"牛膝盖骨"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"niu","category_sub_name":"牛肉","short_name":"NiuFei","name":"牛肺"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"niu","category_sub_name":"牛肉","short_name":"NiuWuHuaRou","name":"牛五花肉"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"niu","category_sub_name":"牛肉","short_name":"NiuShen","name":"牛肾"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"niu","category_sub_name":"牛肉","short_name":"NiuSui","name":"牛髓"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"niu","category_sub_name":"牛肉","short_name":"NiuDaChang","name":"牛大肠"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"niu","category_sub_name":"牛肉","short_name":"NiuXue","name":"牛血"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"niu","category_sub_name":"牛肉","short_name":"NiuWaiJi","name":"牛外脊"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"niu","category_sub_name":"牛肉","short_name":"NiuXiaoPai","name":"牛小排"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"niu","category_sub_name":"牛肉","short_name":"HuangNiuRou","name":"黄牛肉"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"niu","category_sub_name":"牛肉","short_name":"NiuBanJin","name":"牛板筋"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"niu","category_sub_name":"牛肉","short_name":"MaoDu","name":"毛肚"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"niu","category_sub_name":"牛肉","short_name":"NiuLin","name":"牛霖"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"ji","category_sub_name":"鸡肉","short_name":"JiRou","name":"鸡肉"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"ji","category_sub_name":"鸡肉","short_name":"JiChi","name":"鸡翅"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"ji","category_sub_name":"鸡肉","short_name":"JiTui","name":"鸡腿"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"ji","category_sub_name":"鸡肉","short_name":"JiZha","name":"鸡爪"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"ji","category_sub_name":"鸡肉","short_name":"WuJi","name":"乌鸡"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"ji","category_sub_name":"鸡肉","short_name":"JiGuJia","name":"鸡骨架"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"ji","category_sub_name":"鸡肉","short_name":"ChiGen","name":"翅根"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"ji","category_sub_name":"鸡肉","short_name":"JiBo","name":"鸡脖"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"ji","category_sub_name":"鸡肉","short_name":"LaoMuJi","name":"老母鸡"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"ji","category_sub_name":"鸡肉","short_name":"JiZhongChi","name":"鸡中翅"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"ji","category_sub_name":"鸡肉","short_name":"JiZhen","name":"鸡胗"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"ji","category_sub_name":"鸡肉","short_name":"JiXiongRou","name":"鸡胸肉"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"ji","category_sub_name":"鸡肉","short_name":"ShanJi","name":"山鸡"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"ji","category_sub_name":"鸡肉","short_name":"ChiJian","name":"翅尖"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"ji","category_sub_name":"鸡肉","short_name":"ChaiJi","name":"柴鸡"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"ji","category_sub_name":"鸡肉","short_name":"JiShen","name":"鸡肾"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"ji","category_sub_name":"鸡肉","short_name":"SanHuangJi","name":"三黄鸡"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"ji","category_sub_name":"鸡肉","short_name":"PiPaTui","name":"琵琶腿"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"ji","category_sub_name":"鸡肉","short_name":"JiCuiGu","name":"鸡脆骨"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"ji","category_sub_name":"鸡肉","short_name":"JiZa","name":"鸡杂"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"ji","category_sub_name":"鸡肉","short_name":"JiXin","name":"鸡心"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"ji","category_sub_name":"鸡肉","short_name":"JiGan","name":"鸡肝"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"ji","category_sub_name":"鸡肉","short_name":"HuoJi","name":"火鸡"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"ji","category_sub_name":"鸡肉","short_name":"ZhengJi","name":"整鸡"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"ji","category_sub_name":"鸡肉","short_name":"ZiJi","name":"仔鸡"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"ji","category_sub_name":"鸡肉","short_name":"RouJi","name":"肉鸡"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"ji","category_sub_name":"鸡肉","short_name":"JiPi","name":"鸡皮"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"ji","category_sub_name":"鸡肉","short_name":"JiXue","name":"鸡血"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"ji","category_sub_name":"鸡肉","short_name":"JiPiGu","name":"鸡屁股"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"ji","category_sub_name":"鸡肉","short_name":"TuJi","name":"土鸡"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"ji","category_sub_name":"鸡肉","short_name":"ChunJi","name":"春鸡"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"ji","category_sub_name":"鸡肉","short_name":"WenChangJi","name":"文昌鸡"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"ji","category_sub_name":"鸡肉","short_name":"GongTingJi","name":"宫廷鸡"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"ji","category_sub_name":"鸡肉","short_name":"TongZiJi","name":"童子鸡"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"yang","category_sub_name":"羊肉","short_name":"YangRou","name":"羊肉"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"yang","category_sub_name":"羊肉","short_name":"YangPai","name":"羊排"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"yang","category_sub_name":"羊肉","short_name":"YangXie","name":"羊蝎子"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"yang","category_sub_name":"羊肉","short_name":"YangXue","name":"羊血"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"yang","category_sub_name":"羊肉","short_name":"YangXin","name":"羊心"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"yang","category_sub_name":"羊肉","short_name":"YangTi","name":"羊蹄"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"yang","category_sub_name":"羊肉","short_name":"YangNao","name":"羊脑"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"yang","category_sub_name":"羊肉","short_name":"YangFei","name":"羊肺"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"yang","category_sub_name":"羊肉","short_name":"YangTuiRou","name":"羊腿肉"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"yang","category_sub_name":"羊肉","short_name":"YangTou","name":"羊头"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"yang","category_sub_name":"羊肉","short_name":"YangDu","name":"羊肚"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"yang","category_sub_name":"羊肉","short_name":"YangNan","name":"羊腩"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"yang","category_sub_name":"羊肉","short_name":"YangTouRou","name":"羊头肉"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"yang","category_sub_name":"羊肉","short_name":"YangQianTuiRou","name":"羊前腿肉"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"yang","category_sub_name":"羊肉","short_name":"YangHouTuiRou","name":"羊后腿肉"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"yang","category_sub_name":"羊肉","short_name":"YangLiJi","name":"羊里脊"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"yang","category_sub_name":"羊肉","short_name":"YangYaoZi","name":"羊腰子"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"yang","category_sub_name":"羊肉","short_name":"YangYan","name":"羊眼"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"yang","category_sub_name":"羊肉","short_name":"YangGan","name":"羊肝"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"yang","category_sub_name":"羊肉","short_name":"YangGu","name":"羊骨"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"yang","category_sub_name":"羊肉","short_name":"YangSui","name":"羊髓"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"yang","category_sub_name":"羊肉","short_name":"YangJianPai","name":"羊肩排"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"yang","category_sub_name":"羊肉","short_name":"YangDaChang","name":"羊大肠"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"yang","category_sub_name":"羊肉","short_name":"YangShe","name":"羊舌"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"yang","category_sub_name":"羊肉","short_name":"yangtijing","name":"羊蹄筋"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"yang","category_sub_name":"羊肉","short_name":"YangTun","name":"羊臀"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"yang","category_sub_name":"羊肉","short_name":"YangWei","name":"羊尾"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"yang","category_sub_name":"羊肉","short_name":"YangZa","name":"羊杂"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"dan","category_sub_name":"蛋类","short_name":"JiDan","name":"鸡蛋"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"dan","category_sub_name":"蛋类","short_name":"YaDan","name":"鸭蛋"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"dan","category_sub_name":"蛋类","short_name":"AnChunDan","name":"鹌鹑蛋"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"dan","category_sub_name":"蛋类","short_name":"PiDan","name":"皮蛋"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"dan","category_sub_name":"蛋类","short_name":"EDan","name":"鹅蛋"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"dan","category_sub_name":"蛋类","short_name":"GeZiDan","name":"鸽子蛋"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"dan","category_sub_name":"蛋类","short_name":"DanQing","name":"蛋清"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"dan","category_sub_name":"蛋类","short_name":"DanHuang","name":"蛋黄"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"dan","category_sub_name":"蛋类","short_name":"QuanDanYe","name":"全蛋液"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"dan","category_sub_name":"蛋类","short_name":"XianJiDan","name":"咸鸡蛋"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"dan","category_sub_name":"蛋类","short_name":"XianYaDan","name":"咸鸭蛋"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"dan","category_sub_name":"蛋类","short_name":"XianEDan","name":"咸鹅蛋"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"dan","category_sub_name":"蛋类","short_name":"SongHuaDan","name":"松花蛋"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"dan","category_sub_name":"蛋类","short_name":"LuDan","name":"卤蛋"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"dan","category_sub_name":"蛋类","short_name":"WuJiDan","name":"乌鸡蛋"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"dan","category_sub_name":"蛋类","short_name":"MaQueDan","name":"麻雀蛋"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"dan","category_sub_name":"蛋类","short_name":"GeDan","name":"鸽蛋"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"dan","category_sub_name":"蛋类","short_name":"DanBai","name":"蛋白"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"dan","category_sub_name":"蛋类","short_name":"DanYe","name":"蛋液"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"dan","category_sub_name":"蛋类","short_name":"XianDanHuang","name":"咸蛋黄"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"dan","category_sub_name":"蛋类","short_name":"JiDanGan","name":"鸡蛋干"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"rou","category_sub_name":"其它肉类","short_name":"LaRou","name":"腊肉"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"rou","category_sub_name":"其它肉类","short_name":"HuoTui","name":"火腿"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"rou","category_sub_name":"其它肉类","short_name":"XiangChang","name":"香肠"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"rou","category_sub_name":"其它肉类","short_name":"GouRou","name":"狗肉"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"rou","category_sub_name":"其它肉类","short_name":"Xue","name":"血"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"rou","category_sub_name":"其它肉类","short_name":"XiongZhang","name":"熊掌"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"rou","category_sub_name":"其它肉类","short_name":"WoNiu","name":"蜗牛"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"rou","category_sub_name":"其它肉类","short_name":"LuRou","name":"鹿肉"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"rou","category_sub_name":"其它肉类","short_name":"YeWei","name":"野味"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"rou","category_sub_name":"其它肉类","short_name":"YeTu","name":"野兔"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"rou","category_sub_name":"其它肉类","short_name":"JiGu","name":"脊骨"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"rou","category_sub_name":"其它肉类","short_name":"SheRou","name":"蛇肉"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"rou","category_sub_name":"其它肉类","short_name":"PeiGen","name":"培根"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"rou","category_sub_name":"其它肉类","short_name":"TuRou","name":"兔肉"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"rou","category_sub_name":"其它肉类","short_name":"LvRou","name":"驴肉"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"rou","category_sub_name":"其它肉类","short_name":"TianJi","name":"田鸡"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"rou","category_sub_name":"其它肉类","short_name":"CuiGu","name":"脆骨"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"rou","category_sub_name":"其它肉类","short_name":"RouSong","name":"肉松"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"rou","category_sub_name":"其它肉类","short_name":"ChaoShaoRou","name":"叉烧肉"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"rou","category_sub_name":"其它肉类","short_name":"WuCanRou","name":"午餐肉"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"rou","category_sub_name":"其它肉类","short_name":"XunRou","name":"熏肉"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"rou","category_sub_name":"其它肉类","short_name":"XianRou","name":"咸肉"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"rou","category_sub_name":"其它肉类","short_name":"TuTou","name":"兔头"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"rou","category_sub_name":"其它肉类","short_name":"LvBian","name":"驴鞭"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"rou","category_sub_name":"其它肉类","short_name":"CuiPiChang","name":"脆皮肠"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"rou","category_sub_name":"其它肉类","short_name":"TianJiTui","name":"田鸡腿"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"rou","category_sub_name":"其它肉类","short_name":"MaRou","name":"马肉"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"rou","category_sub_name":"其它肉类","short_name":"MaXin","name":"马心"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"rou","category_sub_name":"其它肉类","short_name":"FangTui","name":"方腿"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"rou","category_sub_name":"其它肉类","short_name":"LaChang","name":"腊肠"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"rou","category_sub_name":"其它肉类","short_name":"RouWan","name":"肉丸"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"rou","category_sub_name":"其它肉类","short_name":"HuangHou","name":"黄喉"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"rou","category_sub_name":"其它肉类","short_name":"FengRou","name":"风肉"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"rou","category_sub_name":"其它肉类","short_name":"TuTui","name":"兔腿"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"rou","category_sub_name":"其它肉类","short_name":"ZhuYouZha","name":"猪油渣"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"qin","category_sub_name":"鸭鹅鸽","short_name":"YaRou","name":"鸭肉"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"qin","category_sub_name":"鸭鹅鸽","short_name":"YaGan","name":"鸭肝"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"qin","category_sub_name":"鸭鹅鸽","short_name":"YaZi","name":"鸭子"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"qin","category_sub_name":"鸭鹅鸽","short_name":"YeYa","name":"野鸭"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"qin","category_sub_name":"鸭鹅鸽","short_name":"ShuiYa","name":"水鸭"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"qin","category_sub_name":"鸭鹅鸽","short_name":"YaBo","name":"鸭脖"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"qin","category_sub_name":"鸭鹅鸽","short_name":"YaJia","name":"鸭架"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"qin","category_sub_name":"鸭鹅鸽","short_name":"YaXie","name":"鸭血"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"qin","category_sub_name":"鸭鹅鸽","short_name":"GeZi","name":"鸽子"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"qin","category_sub_name":"鸭鹅鸽","short_name":"AnChun","name":"鹌鹑"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"qin","category_sub_name":"鸭鹅鸽","short_name":"YaXin","name":"鸭心"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"qin","category_sub_name":"鸭鹅鸽","short_name":"E","name":"鹅"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"qin","category_sub_name":"鸭鹅鸽","short_name":"YaXiong","name":"鸭胸"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"qin","category_sub_name":"鸭鹅鸽","short_name":"YaChi","name":"鸭翅"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"qin","category_sub_name":"鸭鹅鸽","short_name":"YaZhang","name":"鸭掌"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"qin","category_sub_name":"鸭鹅鸽","short_name":"YaTui","name":"鸭腿"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"qin","category_sub_name":"鸭鹅鸽","short_name":"YaShe","name":"鸭舌"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"qin","category_sub_name":"鸭鹅鸽","short_name":"YaZhen","name":"鸭胗"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"qin","category_sub_name":"鸭鹅鸽","short_name":"RuGe","name":"乳鸽"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"qin","category_sub_name":"鸭鹅鸽","short_name":"EGan","name":"鹅肝"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"qin","category_sub_name":"鸭鹅鸽","short_name":"YaTou","name":"鸭头"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"qin","category_sub_name":"鸭鹅鸽","short_name":"YaChang","name":"鸭肠"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"qin","category_sub_name":"鸭鹅鸽","short_name":"ERou","name":"鹅肉"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"qin","category_sub_name":"鸭鹅鸽","short_name":"EGan","name":"鹅肝"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"qin","category_sub_name":"鸭鹅鸽","short_name":"JiZhun","name":"鸡肫"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"qin","category_sub_name":"鸭鹅鸽","short_name":"BeiJingTianYa","name":"北京填鸭"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"qin","category_sub_name":"鸭鹅鸽","short_name":"BaiYa","name":"白鸭"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"qin","category_sub_name":"鸭鹅鸽","short_name":"BaiYaXue","name":"白鸭血"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"qin","category_sub_name":"鸭鹅鸽","short_name":"TuFanYa","name":"土番鸭"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"qin","category_sub_name":"鸭鹅鸽","short_name":"YaYi","name":"鸭胰"},{"category_id":"rqd","category_name":"肉禽蛋","category_sub_id":"qin","category_sub_name":"鸭鹅鸽","short_name":"YaZhun","name":"鸭肫"}];
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
