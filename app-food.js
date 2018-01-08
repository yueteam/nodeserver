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
        var scArr = [{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"PingGuo","name":"苹果"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"XiangJiao","name":"香蕉"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"NingMeng","name":"柠檬"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"BoLuo","name":"菠萝"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"CaoMei","name":"草莓"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"ShanZha","name":"山楂"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"Li","name":"梨"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"Xing","name":"杏"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"LiZiLiZi","name":"李子"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"MiHouTao","name":"猕猴桃"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"YouZi","name":"柚子"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"MangGuo","name":"芒果"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"ShiZi","name":"柿子"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"LiZhi","name":"荔枝"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"ShiLiu","name":"石榴"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"PuTao","name":"葡萄"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"YingTao","name":"樱桃"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"XiGua","name":"西瓜"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"MuGua","name":"木瓜"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"ShengNvGuo","name":"圣女果"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"Zao","name":"枣"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"HuoLongGuo","name":"火龙果"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"YeZi","name":"椰子"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"WuHuaGuo","name":"无花果"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"ShaLi","name":"沙梨"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"NiuYouGuo","name":"牛油果"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"LuoHanGuo","name":"罗汉果"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"JvZi","name":"橘子"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"LingJiao","name":"菱角"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"QingMuGua","name":"青木瓜"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"NuiYouGuo","name":"牛油果"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"GuoJiang","name":"果酱"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"JuZi","name":"桔子"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"ChengZiChengZi","name":"橙子"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"YangMei","name":"杨梅"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"HuangTao","name":"黄桃"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"Tao","name":"桃"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"ManYueMei","name":"蔓越莓"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"LiuLian","name":"榴莲"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"HeiJiaLun","name":"黑加仑"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"JinJu","name":"金桔"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"ShuMei","name":"树莓"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"BaiXiangGuo","name":"百香果"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"LanMeiJiang","name":"蓝莓酱"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"GanZhe","name":"甘蔗"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"CaoMeiJiang","name":"草莓酱"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"BaiXiangGuo","name":"百香果"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"SuanZao","name":"酸枣"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"HaMiGua","name":"哈密瓜"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"SangShen","name":"桑葚"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"XiangGua","name":"香瓜"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"YangTao","name":"杨桃"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"LanMei","name":"蓝莓"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"XiMei","name":"西梅"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"PingGuoJiang","name":"苹果酱"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"GanZheZhi","name":"甘蔗汁"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"ShanZhaJiang","name":"山楂酱"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"HuangTaoJiang","name":"黄桃酱"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"JuFengPuTao","name":"巨峰葡萄"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"BuLang","name":"布朗"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"BoLuoMi","name":"菠萝蜜"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"RenXinGuo","name":"人心果"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"JinFengLi","name":"锦丰梨"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"RenShenGuo","name":"人参果"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"BaiLanGua","name":"白兰瓜"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"BaiJinGua","name":"白金瓜"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"JinTaSiGua","name":"金塔寺瓜"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"JiuBaoTao","name":"久保桃"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"JingBaiLi","name":"京白梨"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"JinSiXiaoZao","name":"金丝小枣"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"BaiFenTao","name":"白粉桃"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"BaJiaoa","name":"芭蕉"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"BaLe","name":"芭乐"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"KuErLeLi","name":"库尔勒梨"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"ShanZhu","name":"山竹"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"ShuiMiTao","name":"水蜜桃"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"ShenMiGuo","name":"神秘果"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"LiZiXing","name":"李子杏"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"ShaGuo","name":"沙果"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"ShaJi","name":"沙棘"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"SheGuo","name":"蛇果"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"ShiJia","name":"释迦"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"BeiJiao","name":"北蕉"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"BingLang","name":"槟榔"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"LianWu","name":"莲雾"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"LvCheng","name":"绿橙"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"CuLi","name":"醋栗"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"CiLi","name":"刺梨"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"ChangBaLi","name":"长把梨"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"LuGan","name":"芦柑"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"LaiYangLi","name":"莱阳梨"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"LaoLi","name":"酪梨"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"LiLinJiao","name":"李林蕉"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"TianGua","name":"甜瓜"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"TiZi","name":"提子"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"MaNaiZiPuTao","name":"马奶子葡萄"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"MuLi","name":"木梨"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"MoPanShi","name":"磨盘柿"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"MeiGuiJiao","name":"玫瑰蕉"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"WoJinPingGuo","name":"倭锦苹果"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"XiFanLian","name":"西番莲"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"XiGongJiao","name":"西贡蕉"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"ZhuGuangPingGuo","name":"祝光苹果"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"XiangChuan","name":"香椽"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"MianBaoGuo","name":"面包果"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"MiYunXiaoZao","name":"密云小枣"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"XiaoMiJiao","name":"小米蕉"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"MingYueLi","name":"明月梨"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"QingMei","name":"青梅"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"MaTiHuangLi","name":"马蹄黄梨"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"XiaoXiGua","name":"小西瓜"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"MaNaoShiLiu","name":"玛瑙石榴"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"MiJu","name":"蜜桔"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"MeiGuiXiangPuTao","name":"玫瑰香葡萄"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"MeiZi","name":"梅子"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"NaiShiZi","name":"奶柿子"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"PiPa","name":"枇杷"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"PuTaoYou","name":"葡萄柚"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"ShuiPuTao","name":"蒲桃"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"PingGuoLi","name":"苹果梨"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"XueHuaLi","name":"雪花梨"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"HongFuShiPingGuo","name":"红富士苹果"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"QingMangGuo","name":"青芒果"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"QingFengTao","name":"庆丰桃"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"XueCheng","name":"血橙"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"XiYangLi","name":"西洋梨"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"QiuLiMengPingGuo","name":"秋里蒙苹果"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"YinDuPingGuo","name":"印度苹果"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"YeZiRou","name":"椰子肉"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"YeZhi","name":"椰汁"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"YeZao","name":"椰枣"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"QingPingGuo","name":"青苹果"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"YaGuangLi","name":"鸭广梨"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"YaLi","name":"鸭梨"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"YouPi","name":"油皮"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"YuGanZi","name":"余柑子"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"ZhiMaJiao","name":"芝麻蕉"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"ZaoJu","name":"早桔"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"DongZao","name":"冬枣"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"DongGuoLi","name":"冬果梨"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"DanHuangGuo","name":"蛋黄果"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"FuPingGuo","name":"伏苹果"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"FenJiao","name":"粉蕉"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"FengYanGuo","name":"凤眼果"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"FuJu","name":"福橘"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"GuoGuangPingGuo","name":"国光苹果"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"HongXiangJiao","name":"红香蕉"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"HuangHeMiGua","name":"黄河蜜瓜"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"HongYuPingGuo","name":"红玉苹果"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"HongTi","name":"红提"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"HuangPiGuo","name":"黄皮果"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"HongGuo","name":"红果"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"HeiGanLan","name":"黑橄榄"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"ShanMei","name":"山莓"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"NingMengZhi","name":"柠檬汁"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"XianRenZhangGuo","name":"仙人掌果"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"XiGuaPi","name":"西瓜皮"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"CheLiZi","name":"车厘子"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"HongPiLi","name":"红啤梨"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"XiYou","name":"西柚"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"LongYan","name":"龙眼"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"WuMei","name":"乌梅"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"PingGuoCu","name":"苹果醋"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"ShaJiZhi","name":"沙棘汁"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"QiYiGuo","name":"奇异果"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"FengLi","name":"凤梨"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"YouZiPi","name":"柚子皮"},{"category_id":"sg","category_name":"水果","category_sub_id":"xianguo","category_sub_name":"鲜果","short_name":"FengShuiLi","name":"丰水梨"},{"category_id":"sg","category_name":"水果","category_sub_id":"ganguo","category_sub_name":"干果","short_name":"LiZi","name":"栗子"},{"category_id":"sg","category_name":"水果","category_sub_id":"ganguo","category_sub_name":"干果","short_name":"HuaSheng","name":"花生"},{"category_id":"sg","category_name":"水果","category_sub_id":"ganguo","category_sub_name":"干果","short_name":"YaoGuo","name":"腰果"},{"category_id":"sg","category_name":"水果","category_sub_id":"ganguo","category_sub_name":"干果","short_name":"BaiGuo","name":"白果"},{"category_id":"sg","category_name":"水果","category_sub_id":"ganguo","category_sub_name":"干果","short_name":"SongZi","name":"松子"},{"category_id":"sg","category_name":"水果","category_sub_id":"ganguo","category_sub_name":"干果","short_name":"HeTao","name":"核桃"},{"category_id":"sg","category_name":"水果","category_sub_id":"ganguo","category_sub_name":"干果","short_name":"ZhiMa","name":"芝麻"},{"category_id":"sg","category_name":"水果","category_sub_id":"ganguo","category_sub_name":"干果","short_name":"XingRen","name":"杏仁"},{"category_id":"sg","category_name":"水果","category_sub_id":"ganguo","category_sub_name":"干果","short_name":"LianZi","name":"莲子"},{"category_id":"sg","category_name":"水果","category_sub_id":"ganguo","category_sub_name":"干果","short_name":"GouQi","name":"枸杞"},{"category_id":"sg","category_name":"水果","category_sub_id":"ganguo","category_sub_name":"干果","short_name":"GuiYuan","name":"桂圆"},{"category_id":"sg","category_name":"水果","category_sub_id":"ganguo","category_sub_name":"干果","short_name":"MaiYa","name":"麦芽"},{"category_id":"sg","category_name":"水果","category_sub_id":"ganguo","category_sub_name":"干果","short_name":"SuanZaoRen","name":"酸枣仁"},{"category_id":"sg","category_name":"水果","category_sub_id":"ganguo","category_sub_name":"干果","short_name":"HeiZhiMa","name":"黑芝麻"},{"category_id":"sg","category_name":"水果","category_sub_id":"ganguo","category_sub_name":"干果","short_name":"PuTaoGan","name":"葡萄干"},{"category_id":"sg","category_name":"水果","category_sub_id":"ganguo","category_sub_name":"干果","short_name":"GuaZiRen","name":"瓜子仁"},{"category_id":"sg","category_name":"水果","category_sub_id":"ganguo","category_sub_name":"干果","short_name":"ZhenZi","name":"榛子"},{"category_id":"sg","category_name":"水果","category_sub_id":"ganguo","category_sub_name":"干果","short_name":"NingMengPian","name":"柠檬片"},{"category_id":"sg","category_name":"水果","category_sub_id":"ganguo","category_sub_name":"干果","short_name":"KaiXinGuo","name":"开心果"},{"category_id":"sg","category_name":"水果","category_sub_id":"ganguo","category_sub_name":"干果","short_name":"XiaoHuTao","name":"小胡桃"},{"category_id":"sg","category_name":"水果","category_sub_id":"ganguo","category_sub_name":"干果","short_name":"ShanZhaGan","name":"山楂干"},{"category_id":"sg","category_name":"水果","category_sub_id":"ganguo","category_sub_name":"干果","short_name":"HongZao","name":"红枣"},{"category_id":"sg","category_name":"水果","category_sub_id":"ganguo","category_sub_name":"干果","short_name":"HuaMei","name":"话梅"},{"category_id":"sg","category_name":"水果","category_sub_id":"ganguo","category_sub_name":"干果","short_name":"HeiZao","name":"黑枣"},{"category_id":"sg","category_name":"水果","category_sub_id":"ganguo","category_sub_name":"干果","short_name":"GuoPu","name":"果脯"},{"category_id":"sg","category_name":"水果","category_sub_id":"ganguo","category_sub_name":"干果","short_name":"ManYueMei","name":"蔓越莓"},{"category_id":"sg","category_name":"水果","category_sub_id":"ganguo","category_sub_name":"干果","short_name":"BoLuoMiZi","name":"菠萝蜜子"},{"category_id":"sg","category_name":"水果","category_sub_id":"ganguo","category_sub_name":"干果","short_name":"ShanHeTao","name":"山核桃"},{"category_id":"sg","category_name":"水果","category_sub_id":"ganguo","category_sub_name":"干果","short_name":"TaoRen","name":"桃仁"},{"category_id":"sg","category_name":"水果","category_sub_id":"ganguo","category_sub_name":"干果","short_name":"MaoHeTao","name":"毛核桃"},{"category_id":"sg","category_name":"水果","category_sub_id":"ganguo","category_sub_name":"干果","short_name":"XiGuaZi","name":"西瓜子"},{"category_id":"sg","category_name":"水果","category_sub_id":"ganguo","category_sub_name":"干果","short_name":"XiangFei","name":"香榧"},{"category_id":"sg","category_name":"水果","category_sub_id":"ganguo","category_sub_name":"干果","short_name":"XiangShi","name":"橡实"},{"category_id":"sg","category_name":"水果","category_sub_id":"ganguo","category_sub_name":"干果","short_name":"MeiGuoDaXingRen","name":"美国大杏仁"},{"category_id":"sg","category_name":"水果","category_sub_id":"ganguo","category_sub_name":"干果","short_name":"DaZao","name":"大枣"},{"category_id":"sg","category_name":"水果","category_sub_id":"ganguo","category_sub_name":"干果","short_name":"BaiZhiMa","name":"白芝麻"},{"category_id":"sg","category_name":"水果","category_sub_id":"ganguo","category_sub_name":"干果","short_name":"MiZao","name":"蜜枣"},{"category_id":"sg","category_name":"水果","category_sub_id":"ganguo","category_sub_name":"干果","short_name":"XingRenPian","name":"杏仁片"},{"category_id":"sg","category_name":"水果","category_sub_id":"ganguo","category_sub_name":"干果","short_name":"BaDanMu","name":"巴旦木"},{"category_id":"sg","category_name":"水果","category_sub_id":"ganguo","category_sub_name":"干果","short_name":"LianRong","name":"莲蓉"},{"category_id":"sg","category_name":"水果","category_sub_id":"ganguo","category_sub_name":"干果","short_name":"NanXingRen","name":"南杏仁"},{"category_id":"sg","category_name":"水果","category_sub_id":"ganguo","category_sub_name":"干果","short_name":"BeiXingRen","name":"北杏仁"}];
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
