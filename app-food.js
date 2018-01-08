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
        var scArr = [{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"CaoYu","name":"草鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"LiYu","name":"鲤鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"JiYu","name":"鲫鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"LuYu","name":"鲈鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"LianYu","name":"鲢鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"QingYu","name":"青鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"GuiYu","name":"桂鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"NianYu","name":"鲶鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"ManYu","name":"鳗鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"SanWenYu","name":"三文鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"YuYuTou","name":"鱼头"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"ZhenYu","name":"针鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"XiangPiYu","name":"橡皮鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"LingYu","name":"鲮鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"HuangShan","name":"黄鳝"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"ShaYu","name":"鲨鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"SanDaoLin","name":"三道鳞"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"HeiYu","name":"黑鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"ChaiYu","name":"柴鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"BianYu","name":"鳊鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"BiMuYu","name":"比目鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"PangTouYu","name":"胖头鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"NiQiu","name":"泥鳅"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"YinYu","name":"银鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"WuTouYu","name":"乌头鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"HuangGuYu","name":"黄骨鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"BaiTiaoYu","name":"白条鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"LuoFeiYu","name":"罗非鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"HuiYu","name":"鮰鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"DingXiangYu","name":"丁香鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"WuJiangYu","name":"乌江鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"SanWenYuTou","name":"三文鱼头"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"YuPi","name":"鱼皮"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"XunYu","name":"鲟鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"DuoChunYu","name":"多春鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"LingJiYu","name":"鲮鲫鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"DuoBaoYu","name":"多宝鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"YinXueYu","name":"银鳕鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"YuZi","name":"鱼籽"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"SuoYu","name":"梭鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"YuWei","name":"鱼尾"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"BaPiYu","name":"扒皮鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"ShiYu","name":"鲥鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"WuChangYu","name":"武昌鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"YongYu","name":"鳙鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"HongZunYu","name":"虹鳟鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"MianYu","name":"鮸鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"DiaoYu","name":"鲷鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"LongLiYu","name":"龙利鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"YuGan","name":"鱼干"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"YuSong","name":"鱼松"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"XieLiu","name":"蟹柳"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"YuZiJiang","name":"鱼子酱"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"MuYuHua","name":"木鱼花"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"RouHanYu","name":"肉魽鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"RunSi","name":"软丝"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"BaiGuYu","name":"白姑鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"ShiTouYu","name":"狮头鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"SheZi","name":"蛇鲻"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"ShaZuanYu","name":"沙钻鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"SiPoYu","name":"四破鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"ShuiJingYu","name":"水晶鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"BaiYu","name":"白鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"ShanYu","name":"鳝鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"BanYu","name":"板鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"BaoGongYu","name":"包公鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"LvDouYu","name":"绿豆鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"TuShiYu","name":"土虱鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"BaiChangYu","name":"白鲳鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"CaoYuWei","name":"草鱼尾"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"JunCaoYu","name":"军曹鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"TiYu","name":"鯷鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"LeYu","name":"鳓鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"TangShi","name":"塘鲺"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"LiuYeYu","name":"柳叶鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"TaiYangYu","name":"太阳鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"TiaoYu","name":"鲦鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"WuYuZi","name":"乌鱼子"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"MaHaYu","name":"马哈鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"WenZaiYu","name":"吻仔鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"WuZaiYu","name":"乌仔鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"WuGuoYu","name":"吴郭鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"XianTaiYu","name":"香鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"HaiXiangYu","name":"象鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"NiLuoHongYu","name":"尼罗红鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"XueBanYu","name":"雪斑鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"QiYu","name":"旗鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"QingYuGan","name":"青鱼肝"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"QingGanYu","name":"青甘鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"TaiYu","name":"鲐鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"YuXiaBa","name":"鱼下巴"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"ZhuJiaYu","name":"竹荚鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"ZhenZhuShiBan","name":"珍珠石斑"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"DiaoZiYu","name":"刁子鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"GanYu","name":"感鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"GuiYu","name":"鲑鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"GouMuYu","name":"狗母鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"WeiYu","name":"鲔鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"HuangSangYu","name":"黄颡鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"HuangFang","name":"黄鲂"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"HongGanYu","name":"红甘鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"danshuiyu","category_sub_name":"淡水鱼","short_name":"YaPianYu","name":"鸦片鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"haishuiyu","category_sub_name":"海水鱼","short_name":"DaiYu","name":"带鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"haishuiyu","category_sub_name":"海水鱼","short_name":"HuangYu","name":"黄鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"haishuiyu","category_sub_name":"海水鱼","short_name":"XueYu","name":"鳕鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"haishuiyu","category_sub_name":"海水鱼","short_name":"BaYu","name":"鲅鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"haishuiyu","category_sub_name":"海水鱼","short_name":"BaYuBaYu","name":"鲃鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"haishuiyu","category_sub_name":"海水鱼","short_name":"JinQiangYu","name":"金枪鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"haishuiyu","category_sub_name":"海水鱼","short_name":"ChangYu","name":"鲳鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"haishuiyu","category_sub_name":"海水鱼","short_name":"HuangHuaYu","name":"黄花鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"haishuiyu","category_sub_name":"海水鱼","short_name":"ShaDingYu","name":"沙丁鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"haishuiyu","category_sub_name":"海水鱼","short_name":"ZiYu","name":"鲻鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"haishuiyu","category_sub_name":"海水鱼","short_name":"TaMuYu","name":"鳎目鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"haishuiyu","category_sub_name":"海水鱼","short_name":"MiYu","name":"米鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"haishuiyu","category_sub_name":"海水鱼","short_name":"AnKangYu","name":"安康鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"haishuiyu","category_sub_name":"海水鱼","short_name":"QQingYu","name":"鲭鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"haishuiyu","category_sub_name":"海水鱼","short_name":"FengWeiYu","name":"凤尾鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"haishuiyu","category_sub_name":"海水鱼","short_name":"QiuDaoYu","name":"秋刀鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"haishuiyu","category_sub_name":"海水鱼","short_name":"ShaJianYu","name":"沙尖鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"haishuiyu","category_sub_name":"海水鱼","short_name":"ShiBanYu","name":"石斑鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"haishuiyu","category_sub_name":"海水鱼","short_name":"ShiMuYu","name":"虱目鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"haishuiyu","category_sub_name":"海水鱼","short_name":"PingYu","name":"平鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"haishuiyu","category_sub_name":"海水鱼","short_name":"JinQiangYuGuanTou","name":"金枪鱼罐头"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"haishuiyu","category_sub_name":"海水鱼","short_name":"BaiDaiYu","name":"白带鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"haishuiyu","category_sub_name":"海水鱼","short_name":"MingTaiYu","name":"明太鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"haishuiyu","category_sub_name":"海水鱼","short_name":"MuYuGan","name":"木鱼干"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"haishuiyu","category_sub_name":"海水鱼","short_name":"HaiJiYu","name":"海鲫鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"haishuiyu","category_sub_name":"海水鱼","short_name":"HuangJiaoLi","name":"黄脚笠"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"haishuiyu","category_sub_name":"海水鱼","short_name":"HongChouYu","name":"红绸鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"haishuiyu","category_sub_name":"海水鱼","short_name":"HongShanYu","name":"红衫鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"haishuiyu","category_sub_name":"海水鱼","short_name":"XiaChan","name":"虾潺"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"haishuiyu","category_sub_name":"海水鱼","short_name":"JinChangYu","name":"金鲳鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"haishuiyu","category_sub_name":"海水鱼","short_name":"MaJiaoYu","name":"马鲛鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"haishuiyu","category_sub_name":"海水鱼","short_name":"HaiYu","name":"海鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"xia","category_sub_name":"虾类","short_name":"Xia","name":"虾"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"xia","category_sub_name":"虾类","short_name":"XiaRou","name":"虾肉"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"xia","category_sub_name":"虾类","short_name":"XiaMi","name":"虾米"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"xia","category_sub_name":"虾类","short_name":"LongXia","name":"龙虾"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"xia","category_sub_name":"虾类","short_name":"XiaRen","name":"虾仁"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"xia","category_sub_name":"虾类","short_name":"XiaPi","name":"虾皮"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"xia","category_sub_name":"虾类","short_name":"BaiXia","name":"白虾"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"xia","category_sub_name":"虾类","short_name":"JiWeiXia","name":"基围虾"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"xia","category_sub_name":"虾类","short_name":"HeXia","name":"河虾"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"xia","category_sub_name":"虾类","short_name":"DuiXia","name":"对虾"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"xia","category_sub_name":"虾类","short_name":"BeiJiXia","name":"北极虾"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"xia","category_sub_name":"虾类","short_name":"HaiXia","name":"海虾"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"xia","category_sub_name":"虾类","short_name":"PiPiXia","name":"皮皮虾"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"xia","category_sub_name":"虾类","short_name":"GanxiaRen","name":"干虾仁"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"xia","category_sub_name":"虾类","short_name":"GanXia","name":"干虾"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"xia","category_sub_name":"虾类","short_name":"XiaoXia","name":"小虾"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"xia","category_sub_name":"虾类","short_name":"XiaoLongXia","name":"小龙虾"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"xia","category_sub_name":"虾类","short_name":"HaiMi","name":"海米"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"xia","category_sub_name":"虾类","short_name":"HeXia","name":"河虾"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"xia","category_sub_name":"虾类","short_name":"QingXia","name":"青虾"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"xia","category_sub_name":"虾类","short_name":"MingXia","name":"明虾"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"xia","category_sub_name":"虾类","short_name":"CaoXia","name":"草虾"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"xia","category_sub_name":"虾类","short_name":"BaiXiaMi","name":"白虾米"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"xia","category_sub_name":"虾类","short_name":"BanJieDuiXia","name":"斑节对虾"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"xia","category_sub_name":"虾类","short_name":"BaiCiXia","name":"白刺虾"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"xia","category_sub_name":"虾类","short_name":"ChangMaoDuiXia","name":"长毛对虾"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"xia","category_sub_name":"虾类","short_name":"LaGu","name":"喇蛄"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"xia","category_sub_name":"虾类","short_name":"XiaZi","name":"虾籽"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"xia","category_sub_name":"虾类","short_name":"XiaoHeXia","name":"小河虾"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"xia","category_sub_name":"虾类","short_name":"DongFangDuiXia","name":"东方对虾"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"xia","category_sub_name":"虾类","short_name":"NanMeiXia","name":"南美虾"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"xia","category_sub_name":"虾类","short_name":"XiaHu","name":"虾虎"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"xia","category_sub_name":"虾类","short_name":"YingHuaXia","name":"樱花虾"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"xia","category_sub_name":"虾类","short_name":"QingLongXia","name":"青龙虾"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"xia","category_sub_name":"虾类","short_name":"NanJiLinXia","name":"南极磷虾"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"xia","category_sub_name":"虾类","short_name":"XiaHua","name":"虾滑"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"xie","category_sub_name":"蟹类","short_name":"PangXie","name":"螃蟹"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"xie","category_sub_name":"蟹类","short_name":"XieRou","name":"蟹肉"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"xie","category_sub_name":"蟹类","short_name":"DaZhaXie","name":"大闸蟹"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"xie","category_sub_name":"蟹类","short_name":"HaiXie","name":"海蟹"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"xie","category_sub_name":"蟹类","short_name":"RouXie","name":"肉蟹"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"xie","category_sub_name":"蟹类","short_name":"SuoZiXie","name":"梭子蟹"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"xie","category_sub_name":"蟹类","short_name":"GaoXie","name":"膏蟹"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"xie","category_sub_name":"蟹类","short_name":"HeXie","name":"河蟹"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"xie","category_sub_name":"蟹类","short_name":"QingXie","name":"青蟹"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"xie","category_sub_name":"蟹类","short_name":"DiWangXie","name":"帝王蟹"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"xie","category_sub_name":"蟹类","short_name":"JuYuanQingXie","name":"锯缘青蟹"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"xie","category_sub_name":"蟹类","short_name":"ShiXie","name":"石蟹"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"xie","category_sub_name":"蟹类","short_name":"BaWangXie","name":"霸王蟹"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"xie","category_sub_name":"蟹类","short_name":"DaHuaXie","name":"大花蟹"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"xie","category_sub_name":"蟹类","short_name":"HongXun","name":"红鲟"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"xie","category_sub_name":"蟹类","short_name":"HeLeXie","name":"和乐蟹"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"xie","category_sub_name":"蟹类","short_name":"SanDianXie","name":"三点蟹"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"xie","category_sub_name":"蟹类","short_name":"MianBaoXie","name":"面包蟹"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"bei","category_sub_name":"贝类","short_name":"MoYu","name":"墨鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"bei","category_sub_name":"贝类","short_name":"HaLi","name":"蛤蜊"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"bei","category_sub_name":"贝类","short_name":"MuLi","name":"牡蛎"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"bei","category_sub_name":"贝类","short_name":"BaoYu","name":"鲍鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"bei","category_sub_name":"贝类","short_name":"YouYu","name":"鱿鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"bei","category_sub_name":"贝类","short_name":"ZhangYu","name":"章鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"bei","category_sub_name":"贝类","short_name":"ShanBei","name":"扇贝"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"bei","category_sub_name":"贝类","short_name":"XiangLuo","name":"香螺"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"bei","category_sub_name":"贝类","short_name":"GanBei","name":"干贝"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"bei","category_sub_name":"贝类","short_name":"HaiLuo","name":"海螺"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"bei","category_sub_name":"贝类","short_name":"GanYouYu","name":"干鱿鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"bei","category_sub_name":"贝类","short_name":"GanMoYu","name":"干墨鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"bei","category_sub_name":"贝类","short_name":"YaoZhu","name":"瑶柱"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"bei","category_sub_name":"贝类","short_name":"HaiHong","name":"海虹"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"bei","category_sub_name":"贝类","short_name":"HuangXianZi","name":"黄蚬子"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"bei","category_sub_name":"贝类","short_name":"XianZiRou","name":"蚬子肉"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"bei","category_sub_name":"贝类","short_name":"MaoHan","name":"毛蚶"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"bei","category_sub_name":"贝类","short_name":"LuoShi","name":"螺蛳"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"bei","category_sub_name":"贝类","short_name":"XianBao","name":"鲜鲍"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"bei","category_sub_name":"贝类","short_name":"ChengZi","name":"蛏子"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"bei","category_sub_name":"贝类","short_name":"HaiGuaZi","name":"海瓜子"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"bei","category_sub_name":"贝类","short_name":"XianBei","name":"鲜贝"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"bei","category_sub_name":"贝类","short_name":"LuoRou","name":"螺肉"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"bei","category_sub_name":"贝类","short_name":"TianLuo","name":"田螺"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"bei","category_sub_name":"贝类","short_name":"ShengHao","name":"生蚝"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"bei","category_sub_name":"贝类","short_name":"HuaGe","name":"花蛤"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"bei","category_sub_name":"贝类","short_name":"HaiBang","name":"海蚌"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"bei","category_sub_name":"贝类","short_name":"QingKouBei","name":"青口贝"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"bei","category_sub_name":"贝类","short_name":"HongLuo","name":"红螺"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"bei","category_sub_name":"贝类","short_name":"YiBei","name":"贻贝"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"bei","category_sub_name":"贝类","short_name":"HeXian","name":"河蚬"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"bei","category_sub_name":"贝类","short_name":"HeBang","name":"河蚌"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"bei","category_sub_name":"贝类","short_name":"ChiBei","name":"赤贝"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"bei","category_sub_name":"贝类","short_name":"HaiTu","name":"海兔"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"bei","category_sub_name":"贝类","short_name":"YouYuBan","name":"鱿鱼板"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"bei","category_sub_name":"贝类","short_name":"YouYuQuan","name":"鱿鱼圈"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"bei","category_sub_name":"贝类","short_name":"ShiLuo","name":"石螺"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"bei","category_sub_name":"贝类","short_name":"KongQueHa","name":"孔雀蛤"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"bei","category_sub_name":"贝类","short_name":"LanHuaBang","name":"兰花蚌"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"bei","category_sub_name":"贝类","short_name":"BangKe","name":"蚌壳"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"bei","category_sub_name":"贝类","short_name":"WuZei","name":"乌贼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"bei","category_sub_name":"贝类","short_name":"XiangHaiLuo","name":"香海螺"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"bei","category_sub_name":"贝类","short_name":"XiangBaBang","name":"象拔蚌"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"bei","category_sub_name":"贝类","short_name":"MoYuDan","name":"墨鱼蛋"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"bei","category_sub_name":"贝类","short_name":"NanMeiLuo","name":"南美螺"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"bei","category_sub_name":"贝类","short_name":"XiShiShe","name":"西施舌"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"bei","category_sub_name":"贝类","short_name":"YouYuTou","name":"鱿鱼头"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"bei","category_sub_name":"贝类","short_name":"QiuGeLi","name":"秋蛤蜊"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"bei","category_sub_name":"贝类","short_name":"DanCai","name":"淡菜"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"bei","category_sub_name":"贝类","short_name":"ZaSeGeLi","name":"杂色蛤蜊"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"bei","category_sub_name":"贝类","short_name":"DaiZi","name":"带子"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"bei","category_sub_name":"贝类","short_name":"FuYu","name":"鳆鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"bei","category_sub_name":"贝类","short_name":"FengLuo","name":"凤螺"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"bei","category_sub_name":"贝类","short_name":"HaiLiZi","name":"海蜊子"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"bei","category_sub_name":"贝类","short_name":"HuangLuo","name":"黄螺"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"bei","category_sub_name":"贝类","short_name":"NiaoBei","name":"鸟贝"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"bei","category_sub_name":"贝类","short_name":"BiGuanYu","name":"笔管鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"bei","category_sub_name":"贝类","short_name":"YuanGe","name":"圆蛤"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"qitasc","category_sub_name":"其他水产类","short_name":"HaiZhe","name":"海蜇"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"qitasc","category_sub_name":"其他水产类","short_name":"HaiSen","name":"海参"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"qitasc","category_sub_name":"其他水产类","short_name":"HaiDai","name":"海带"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"qitasc","category_sub_name":"其他水产类","short_name":"ZiCai","name":"紫菜"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"qitasc","category_sub_name":"其他水产类","short_name":"HuaJiao","name":"花胶"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"qitasc","category_sub_name":"其他水产类","short_name":"JiaYu","name":"甲鱼"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"qitasc","category_sub_name":"其他水产类","short_name":"YuChi","name":"鱼翅"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"qitasc","category_sub_name":"其他水产类","short_name":"YuPao","name":"鱼泡"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"qitasc","category_sub_name":"其他水产类","short_name":"QunDaiCai","name":"裙带菜"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"qitasc","category_sub_name":"其他水产类","short_name":"HaiZheTou","name":"海蜇头"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"qitasc","category_sub_name":"其他水产类","short_name":"HaiDan","name":"海胆"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"qitasc","category_sub_name":"其他水产类","short_name":"NiuWa","name":"牛蛙"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"qitasc","category_sub_name":"其他水产类","short_name":"GanHaiDai","name":"干海带"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"qitasc","category_sub_name":"其他水产类","short_name":"YuZa","name":"鱼杂"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"qitasc","category_sub_name":"其他水产类","short_name":"ZhePi","name":"蜇皮"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"qitasc","category_sub_name":"其他水产类","short_name":"EYuRou","name":"鳄鱼肉"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"qitasc","category_sub_name":"其他水产类","short_name":"QiongZhi","name":"琼脂"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"qitasc","category_sub_name":"其他水产类","short_name":"YouYuXu","name":"鱿鱼须"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"qitasc","category_sub_name":"其他水产类","short_name":"FaCai","name":"发菜"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"qitasc","category_sub_name":"其他水产类","short_name":"YuWan","name":"鱼丸"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"qitasc","category_sub_name":"其他水产类","short_name":"YuDoufu","name":"鱼豆腐"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"qitasc","category_sub_name":"其他水产类","short_name":"XieBang","name":"蟹棒"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"qitasc","category_sub_name":"其他水产类","short_name":"HaiTai","name":"海苔"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"qitasc","category_sub_name":"其他水产类","short_name":"YuPian","name":"鱼片"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"qitasc","category_sub_name":"其他水产类","short_name":"RunSiZao","name":"软丝藻"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"qitasc","category_sub_name":"其他水产类","short_name":"JiaYuDan","name":"甲鱼蛋"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"qitasc","category_sub_name":"其他水产类","short_name":"ShiHuaCai","name":"石花菜"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"qitasc","category_sub_name":"其他水产类","short_name":"ShaYuGu","name":"鲨鱼骨"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"qitasc","category_sub_name":"其他水产类","short_name":"HaiDaiJie","name":"海带结"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"qitasc","category_sub_name":"其他水产类","short_name":"ShanHuCao","name":"珊瑚草"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"qitasc","category_sub_name":"其他水产类","short_name":"ChaiYuPian","name":"柴鱼片"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"qitasc","category_sub_name":"其他水产类","short_name":"LuoXuanZao","name":"螺旋藻"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"qitasc","category_sub_name":"其他水产类","short_name":"TaiCai","name":"苔菜"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"qitasc","category_sub_name":"其他水产类","short_name":"YangQiCai","name":"羊栖菜"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"qitasc","category_sub_name":"其他水产类","short_name":"YuChun","name":"鱼唇"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"qitasc","category_sub_name":"其他水产类","short_name":"YuBiao","name":"鱼鳔"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"qitasc","category_sub_name":"其他水产类","short_name":"YuLuan","name":"鱼卵"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"qitasc","category_sub_name":"其他水产类","short_name":"ZhangYuJiao","name":"章鱼脚"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"qitasc","category_sub_name":"其他水产类","short_name":"ZhongGuoHou","name":"中国鲎"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"qitasc","category_sub_name":"其他水产类","short_name":"ZhenQiao","name":"真蛸"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"qitasc","category_sub_name":"其他水产类","short_name":"ZhenZhu","name":"珍珠"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"qitasc","category_sub_name":"其他水产类","short_name":"YuJiaoFen","name":"鱼胶粉"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"qitasc","category_sub_name":"其他水产类","short_name":"GuiYuZiJiang","name":"鲑鱼籽酱"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"qitasc","category_sub_name":"其他水产类","short_name":"ShuiGuoOu","name":"水果藕"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"qitasc","category_sub_name":"其他水产类","short_name":"HaiPuTao","name":"海葡萄"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"qitasc","category_sub_name":"其他水产类","short_name":"HaiCao","name":"海草"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"qitasc","category_sub_name":"其他水产类","short_name":"QunBian","name":"裙边"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"qitasc","category_sub_name":"其他水产类","short_name":"gexianmi","name":"葛仙米"},{"category_id":"sc","category_name":"海鲜水产","category_sub_id":"qitasc","category_sub_name":"其他水产类","short_name":"MuYuHua","name":"目鱼花"}];
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
