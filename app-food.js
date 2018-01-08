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
        var scArr = [{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"BaiCai","name":"白菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"YouCai","name":"油菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"QinCai","name":"芹菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"BoCai","name":"菠菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"SuanMiao","name":"蒜苗"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"YuanBaiCai","name":"圆白菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"XiaoBaiCai","name":"小白菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"JiuCai","name":"韭菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"ShengCai","name":"生菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"TongHao","name":"茼蒿"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"XiangCai","name":"香菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"DouMiao","name":"豆苗"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"LuSun","name":"芦笋"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"XianCai","name":"苋菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"JieCai","name":"芥菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"WoSun","name":"莴笋"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"XueLiHong","name":"雪里蕻"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"JiCai","name":"荠菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"HuangXinCai","name":"黄心菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"JueCai","name":"蕨菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"LuoBoYing","name":"萝卜缨"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"YaCai","name":"芽菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"GanLanCai","name":"橄榄菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"DongCai","name":"冬菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"MaLanTou","name":"马兰头"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"KuJv","name":"苦苣"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"DaBaiCai","name":"大白菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"WoJvYe","name":"莴苣叶"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"ZiYeCai","name":"紫椰菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"WaWaCai","name":"娃娃菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"ZiGanLan","name":"紫甘蓝"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"SuanTai","name":"蒜薹"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"ZiGanLanCai","name":"紫橄榄菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"WuTaCai","name":"乌塌菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"XiQin","name":"西芹"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"XiShengCai","name":"西生菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"AiCao","name":"艾草"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"ZiBaoCai","name":"紫包菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"SuanHuang","name":"蒜黄"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"BaiCaiGeng","name":"白菜梗"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"LuHao","name":"芦蒿"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"KuJu","name":"苦菊"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"KongXinCai","name":"空心菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"JiuHuang","name":"韭黄"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"JieLan","name":"芥兰"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"ShangHaiQing","name":"上海青"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"QingSuan","name":"青蒜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"MeiGanCai","name":"梅干菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"WoJu","name":"莴苣"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"GaiLan","name":"芥蓝"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"LuoBoYing","name":"萝卜缨"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"WoSunYe","name":"莴笋叶"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"YouMaiCai","name":"油麦菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"PuGongYing","name":"蒲公英"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"MaChiCai","name":"马齿菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"MaChiXian","name":"马齿苋"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"ChuanXinLian","name":"穿心莲"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"HaoZiGan","name":"蒿子杆"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"QingCai","name":"青菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"ZiSu","name":"紫苏"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"XiYangCai","name":"西洋菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"ZhiMaCai","name":"芝麻菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"ShuiQinCai","name":"水芹菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"BaoZiGanLan","name":"抱子甘蓝"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"JuHuaCai","name":"菊花菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"GuanYinCai","name":"观音菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"ZiBeiTianKui","name":"紫背天葵"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"ErCai","name":"儿菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"ZiYeShengCai","name":"紫叶生菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"GongCai","name":"贡菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"HuiXiang","name":"茴香"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"HongCaiTai","name":"红菜苔"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"LuHui","name":"芦荟"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"KuXiYeShengCai","name":"苦细叶生菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"CiLaoYa","name":"刺老芽"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"MaYuLan","name":"马郁兰"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"CheQianCao","name":"车前草"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"LuHui","name":"芦荟"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"HeYe","name":"荷叶"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"BianSun","name":"鞭笋"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"KuJuCai","name":"苦苣菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"KuZhuYe","name":"苦竹叶"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"BaoXinCai","name":"包心菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"ShanSu","name":"山苏"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"BaXiLi","name":"巴西利"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"ZiQian","name":"紫钱"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"LuKui","name":"露葵"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"XianCao","name":"仙草"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"TianCaiYe","name":"甜菜叶"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"WuCai","name":"乌菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"MuErCai","name":"木耳菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"MaiPingCao","name":"麦瓶草"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"MuXu","name":"苜蓿"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"NanGuaTeng","name":"南瓜藤"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"NiuBangYe","name":"牛蒡叶"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"NaiBaiCai","name":"奶白菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"PiaoErBai","name":"瓢儿白"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"PuCai","name":"蒲菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"PuGongCao","name":"蒲公草"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"QingJiangCai","name":"青江菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"YeQiao","name":"野荞"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"QiYeDan","name":"七叶胆"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"QingMingCai","name":"清明菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"QingLiao","name":"青蓼"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"QiuJingHuiXiang","name":"球茎茴香"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"YangWeiSun","name":"羊尾笋"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"QinCaiYe","name":"芹菜叶"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"DouFuChai","name":"豆腐柴"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"YueGuiYe","name":"月桂叶"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"DouBanCai","name":"豆瓣菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"DongHanCai","name":"冬寒菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"DiFu","name":"地肤"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"DaBoLiCaoYe","name":"大玻璃草叶"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"FenCong","name":"分葱"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"GuiZhuSun","name":"桂竹笋"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"GuoMao","name":"过猫"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"HeiYouCai","name":"黑油菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"BingCao","name":"冰草"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"suanmo","name":"酸模"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"tacai","name":"塔菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"GanLan","name":"甘蓝"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"LiShanGanLan","name":"梨山甘蓝"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"GaiCai","name":"盖菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"ZiYeYouCai","name":"紫叶油菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"XiangCong","name":"香葱"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"SuanCai","name":"酸菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"CaiTai","name":"菜薹"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jy","category_sub_name":"茎叶类","short_name":"LaBaiCai","name":"辣白菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gua","category_sub_name":"瓜类","short_name":"HuangGua","name":"黄瓜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gua","category_sub_name":"瓜类","short_name":"DongGua","name":"冬瓜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gua","category_sub_name":"瓜类","short_name":"KuGua","name":"苦瓜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gua","category_sub_name":"瓜类","short_name":"NanGua","name":"南瓜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gua","category_sub_name":"瓜类","short_name":"SiGua","name":"丝瓜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gua","category_sub_name":"瓜类","short_name":"FoShou","name":"佛手"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gua","category_sub_name":"瓜类","short_name":"XiHuLu","name":"西葫芦"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gua","category_sub_name":"瓜类","short_name":"JieGua","name":"节瓜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gua","category_sub_name":"瓜类","short_name":"FoShouGua","name":"佛手瓜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gua","category_sub_name":"瓜类","short_name":"HuZi","name":"瓠子"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gua","category_sub_name":"瓜类","short_name":"ShengGua","name":"生瓜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gua","category_sub_name":"瓜类","short_name":"RiBenNanGua","name":"日本南瓜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gua","category_sub_name":"瓜类","short_name":"HuGua","name":"瓠瓜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gua","category_sub_name":"瓜类","short_name":"HuLu","name":"葫芦"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gua","category_sub_name":"瓜类","short_name":"HaiDiYe","name":"海底椰"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gua","category_sub_name":"瓜类","short_name":"JinSiGua","name":"金丝瓜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gua","category_sub_name":"瓜类","short_name":"JinGua","name":"金瓜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gua","category_sub_name":"瓜类","short_name":"BaiGua","name":"白瓜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gua","category_sub_name":"瓜类","short_name":"CaiGua","name":"菜瓜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gua","category_sub_name":"瓜类","short_name":"MiSheGua","name":"蜜蛇瓜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gua","category_sub_name":"瓜类","short_name":"XiaoHuGua","name":"小黄瓜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gua","category_sub_name":"瓜类","short_name":"DongNanGua","name":"冬南瓜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gua","category_sub_name":"瓜类","short_name":"PenGua","name":"喷瓜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gua","category_sub_name":"瓜类","short_name":"QiuHuangGua","name":"秋黄瓜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gua","category_sub_name":"瓜类","short_name":"YueGua","name":"越瓜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gua","category_sub_name":"瓜类","short_name":"FeiDieGua","name":"飞碟瓜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gua","category_sub_name":"瓜类","short_name":"HuZi","name":"葫子"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gua","category_sub_name":"瓜类","short_name":"JinTongYuNvGua","name":"金童玉女瓜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gua","category_sub_name":"瓜类","short_name":"xiangjiaoxihulu","name":"香蕉西葫芦"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gua","category_sub_name":"瓜类","short_name":"YeKaiHua","name":"夜开花"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gua","category_sub_name":"瓜类","short_name":"HeLanGua","name":"荷兰瓜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gua","category_sub_name":"瓜类","short_name":"XiaoDongGua","name":"小冬瓜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gua","category_sub_name":"瓜类","short_name":"PuGua","name":"蒲瓜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gua","category_sub_name":"瓜类","short_name":"LengJiaoSiGua","name":"棱角丝瓜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gua","category_sub_name":"瓜类","short_name":"BeiBeiNanGua","name":"贝贝南瓜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gua","category_sub_name":"瓜类","short_name":"JinJuGua","name":"金桔瓜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gua","category_sub_name":"瓜类","short_name":"WoGua","name":"窝瓜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gua","category_sub_name":"瓜类","short_name":"FeiDieXiHuLu","name":"飞碟西葫芦"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gua","category_sub_name":"瓜类","short_name":"BaiYuKuGua","name":"白玉苦瓜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gua","category_sub_name":"瓜类","short_name":"DiaoGua","name":"吊瓜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"DouJiao","name":"豆角"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"QieZi","name":"茄子"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"QingJiao","name":"青椒"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"XiHongShi","name":"西红柿"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"WanDou","name":"豌豆"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"HeLanDou","name":"荷兰豆"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"JiangDou","name":"豇豆"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"BianDou","name":"扁豆"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"CaiJiao","name":"菜椒"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"SiJiDou","name":"四季豆"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"QiuKui","name":"秋葵"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"MaoDou","name":"毛豆"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"CanDou","name":"蚕豆"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"BanLi","name":"板栗"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"ZiQieZi","name":"紫茄子"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"NanGuaZi","name":"南瓜子"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"WuCaiJiao","name":"五彩椒"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"LaJiao","name":"辣椒"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"ChangQieZi","name":"长茄子"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"GanWanDou","name":"干豌豆"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"HangJiao","name":"杭椒"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"WanDouJian","name":"豌豆尖"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"YuQian","name":"榆钱"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"YouDouJiao","name":"油豆角"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"DaoDou","name":"刀豆"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"ShiZiJiao","name":"柿子椒"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"QieGua","name":"茄瓜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"SiLengDou","name":"四棱豆"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"ChaoTianJiao","name":"朝天椒"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"LongYaDou","name":"龙牙豆"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"TianDou","name":"甜豆"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"WaiTouCai","name":"歪头菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"MoXiGeLaJiao","name":"墨西哥辣椒"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"XianRenZhangGuo","name":"仙人掌果"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"XiaoBianDou","name":"小扁豆"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"XiaoDouKou","name":"小豆蔻"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"MuDou","name":"木豆"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"QieDongYe","name":"茄冬叶"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"BaiQieZi","name":"白茄子"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"DengLongJiao","name":"灯笼椒"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"HeiShiFanQie","name":"黑柿蕃茄"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"HongFanQie","name":"红番茄"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"HuangQiuKui","name":"黄秋葵"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"ShuFanQie","name":"树番茄"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"XiaoXiHongShi","name":"小西红柿"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"ZiChangQie","name":"紫长茄"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"XianQie","name":"线茄"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"LvChangQie","name":"绿长茄"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"LvYuanQie","name":"绿圆茄"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"HuaQieZi","name":"花茄子"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"ZiYuanQie","name":"紫圆茄"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"JianJiao","name":"尖椒"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"ZiJianJiao","name":"紫尖椒"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"HongSeJianJiao","name":"红色尖椒"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"ChaoTianJiao","name":"朝天椒"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"JiaDou","name":"架豆"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"TianYuMi","name":"甜玉米"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"NianYuMi","name":"黏玉米"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"HongQiuKui","name":"红秋葵"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"XianJiao","name":"线椒"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"MeiRenJiao","name":"美人椒"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"FanQie","name":"番茄"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"YuanQieZi","name":"圆茄子"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"ErJingTiao","name":"二荆条"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"MeiDouJiao","name":"梅豆角"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"guo","category_sub_name":"果实类","short_name":"SuanDouJiao","name":"酸豆角"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"LvDouYa","name":"绿豆芽"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"DouYa","name":"豆芽"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"TuDou","name":"土豆"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"HongShu","name":"红薯"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"YuTou","name":"芋头"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"YangCong","name":"洋葱"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"HuLuoBo","name":"胡萝卜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"BaiLuoBo","name":"白萝卜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"ZhuSun","name":"竹笋"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"MoYuMoYu","name":"魔芋"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"ShanYao","name":"山药"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"JiaoBai","name":"茭白"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"Ou","name":"藕"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"NiuPang","name":"牛蒡"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"ZhaCai","name":"榨菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"BiQi","name":"荸荠"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"ZiShu","name":"紫薯"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"ZheErGen","name":"折耳根"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"DiGua","name":"地瓜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"LianOu","name":"莲藕"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"LuoBo","name":"萝卜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"ShuiLuoBo","name":"水萝卜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"TieGunShanYao","name":"铁棍山药"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"HongLuoBo","name":"红萝卜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"DongSun","name":"冬笋"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"ZiGanShu","name":"紫甘薯"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"ShaGe","name":"沙葛"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"SunJian","name":"笋尖"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"XinLiMei","name":"心里美萝卜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"ZiCaiTou","name":"紫菜头"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"LuoHanSun","name":"罗汉笋"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"HeiDouYa","name":"黑豆芽"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"MuShu","name":"木薯"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"QingLuoBo","name":"青萝卜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"PieLan","name":"苤蓝"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"GanSun","name":"干笋"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"HuangDouYa","name":"黄豆芽"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"YuXingCao","name":"鱼腥草"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"YingTaoLuoBo","name":"樱桃萝卜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"XinLiMei","name":"心里美"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"ShouWu","name":"首乌"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"ChunSun","name":"春笋"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"Oudai","name":"藕带"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"XiangYu","name":"香芋"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"BinLangYu","name":"槟榔芋"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"Sun","name":"笋"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"BaiJiangShu","name":"白姜薯"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"LaGen","name":"辣根"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"CiGu","name":"慈姑"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"TianCaiGen","name":"甜菜根"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"WuJing","name":"芜菁"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"DaShu","name":"大薯"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"HeiTuDou","name":"黑土豆"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"XianRenZhang","name":"仙人掌"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"XiangHe","name":"襄荷"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"XiaoShuiLuoBo","name":"小水萝卜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"MoYuSi","name":"魔芋丝"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"NiuWeiSun","name":"牛尾笋"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"PoLuoMenShen","name":"婆罗门参"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"QiaoTou","name":"荞头"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"YeSuan","name":"野蒜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"DouShu","name":"豆薯"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"YangJiang","name":"洋姜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"DaJiaYuTou","name":"大甲芋头"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"GanShu","name":"甘薯"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"GeGen","name":"葛根"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"HongXinLuoBo","name":"红心萝卜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"HongCaiTou","name":"红菜头"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"HongCongTou","name":"红葱头"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"BaiLuSun","name":"白芦笋"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"XieBai","name":"薤白"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"kuaigenqin","name":"块根芹"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"TianCai","name":"甜菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"LiPuYu","name":"荔浦芋"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"LeiSun","name":"雷笋"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"ShaWoLuoBo","name":"沙窝萝卜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"SouZhiHuLuoBo","name":"手指胡萝卜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"SuiGuoPieLan","name":"水果苤蓝"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"ZiYangCong","name":"紫洋葱"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"ZiPieLan","name":"紫苤蓝"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"CuiShanYao","name":"脆山药"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"DaYuTou","name":"大芋头"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"DaYuTou","name":"大芋头"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"XiaoYuTou","name":"小芋头"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"JuRuo","name":"蒟蒻"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"HuaiShan","name":"淮山"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"gj","category_sub_name":"根茎类","short_name":"LuoBoGan","name":"萝卜干"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"MoGu","name":"蘑菇"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"CaoGu","name":"草菇"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"XiangGu","name":"香菇"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"PingGu","name":"平菇"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"JinZhenGu","name":"金针菇"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"KouMo","name":"口蘑"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"HeiMuEr","name":"黑木耳"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"JiGu1","name":"姬菇"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"YinEr","name":"银耳"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"HouTouGu","name":"猴头菇"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"ZhuSunZhuSun","name":"竹荪"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"BaiLingGu","name":"白灵菇"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"BaiYuGu","name":"白玉菇"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"JinQianGu","name":"金钱菇"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"ZhenMo","name":"榛蘑"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"LingZhi","name":"灵芝"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"MuEr","name":"木耳"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"HuaZiGu","name":"滑子菇"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"XieWeiGu","name":"蟹味菇"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"XingBaoGu","name":"杏鲍菇"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"ZhuSheng","name":"竹笙"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"YuanMo","name":"元蘑"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"HongMo","name":"红蘑"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"JiTuiGu","name":"鸡腿菇"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"HuaGu","name":"花菇"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"DongGu","name":"冬菇"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"GanChaShuGu","name":"干茶树菇"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"GanSongRong","name":"干松茸"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"ChaShuGu","name":"茶树菇"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"GanXiangGu","name":"干香菇"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"NiuGanJun","name":"牛肝菌"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"HaiXianGu","name":"海鲜菇"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"ShuangBaoGu","name":"双孢菇"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"JiZong","name":"鸡枞"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"ShiEr","name":"石耳"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"YangDuJun","name":"羊肚菌"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"GanBaJun","name":"干巴菌"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"JiTuCong","name":"鸡土从"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"BeuFengJun","name":"北风菌"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"BaiNiuGanJun","name":"白牛肝菌"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"ShuangBaoMoGu","name":"双孢蘑菇"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"SongMo","name":"松蘑"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"BaoYuGu","name":"鲍鱼菇"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"ShanHuGu","name":"珊瑚菇"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"CaoGuXin","name":"草菇心"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"LiuSongGu","name":"柳松菇"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"WuGu","name":"舞菇"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"XueHongGu","name":"血红菇"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"DiYi","name":"地衣"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"XiaoCaoGu","name":"小草菇"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"DaHongGu","name":"大红菇"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"NiuYanJingJun","name":"牛眼睛菌"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"XiuZhenGu","name":"秀珍菇"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"QingTouJun","name":"青头菌"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"ZhenZhuGu","name":"珍珠菇"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"HuangMo","name":"黄蘑"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"HongXiGu","name":"鸿喜菇"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"HeiJun","name":"黑菌"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"HuiShuHua","name":"灰树花"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"DiPiCai","name":"地皮菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"HeXianGu","name":"荷仙菇"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"LiZhiJun","name":"荔枝菌"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"JiSongRong","name":"姬松茸"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"ChongCaoHua","name":"虫草花"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"XiuZhenGu","name":"袖珍菇"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"YuHuangGu","name":"榆黄菇"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"SongRong","name":"松茸"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"jun","category_sub_name":"菌类","short_name":"ZhenJiGu","name":"真姬菇"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"CaiHua","name":"菜花"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"XiLanHua","name":"西兰花"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"HuangHuaCai","name":"黄花菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"BaiHe","name":"百合"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"XiangChun","name":"香椿"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"JuHua","name":"菊花"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"MeiGuiHua","name":"玫瑰花"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"GuiHua","name":"桂花"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"HuaCai","name":"花菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"LuoBoMiao","name":"萝卜苗"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"WanDouJian","name":"豌豆尖"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"ChunCai","name":"莼菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"CaiXin","name":"菜心"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"JiuCaiHua","name":"韭菜花"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"HuaiHua","name":"槐花"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"JinYinHua","name":"金银花"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"MoLiHua","name":"茉莉花"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"YangGanJu","name":"洋甘菊"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"JianHua","name":"剑花"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"JiuTai","name":"韭苔"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"BaiShaHao","name":"白沙蒿"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"JianPeng","name":"碱蓬"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"BaiHuaCai","name":"白花菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"BaiFengCai","name":"白凤菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"ShanCai","name":"山菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"ShuiHuLu","name":"水葫芦"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"ShuiTianQin","name":"水田芹"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"BaiCaiTai","name":"白菜薹"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"KangNaiXin","name":"康乃馨"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"BiYuSun","name":"碧玉笋"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"BaJiaoHua","name":"芭蕉花"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"SangYe","name":"桑叶"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"LuoLe","name":"罗勒"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"BaiJiangCao","name":"败酱草"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"ShiYongDaHuang","name":"食用大黄"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"SuZiYe","name":"苏子叶"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"LiuLan","name":"柳兰"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"BaiHuaYeCai","name":"白花椰菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"CiErCai","name":"刺儿菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"LanHua","name":"兰花"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"LuoShenHua","name":"洛神花"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"LianJiao","name":"莲蕉"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"WanDouMiao","name":"豌豆苗"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"DuXingCai","name":"独行菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"XiaoCong","name":"小葱"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"MeiHua","name":"梅花"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"MuXuYa","name":"苜蓿芽"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"XiangFengCao","name":"香蜂草"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"XiangPu","name":"香蒲"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"XueCai","name":"雪菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"YouCaiTai","name":"油菜薹"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"YouCaiHua","name":"油菜花"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"QingJinZhenHua","name":"青金针花"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"YeJiuCai","name":"野韭菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"YeCong","name":"野葱"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"ZhiZiHua","name":"栀子花"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"ZhenZhuHuaCai","name":"珍珠花菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"ZiEXiangChaCai","name":"紫萼香茶菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"DaChaoCai","name":"大巢菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"YouJiCaiHua","name":"有机菜花"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"BaoTaCaiHua","name":"宝塔菜花"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"ZiCaiHua","name":"紫菜花"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"KuaiCai","name":"快菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"LvYeShengCai","name":"绿叶生菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"ZiYeShengCai","name":"紫叶生菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"SanYeShengCai","name":"散叶生菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"QiuShengCai","name":"球生菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"NaiYouShengCai","name":"奶油生菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"HaoZiGan","name":"蒿子秆"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"DaYeTongHao","name":"大叶茼蒿"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"XiaoYeTongHao","name":"小叶茼蒿"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"XiangQin","name":"香芹"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"JiMaoCai","name":"鸡毛菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"JingShuiCai","name":"京水菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"YeTianCai","name":"叶菾菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"HongYeXianCai","name":"红叶苋菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"LvYeXianCai","name":"绿叶苋菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"YangXinCai","name":"养心菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"MianTiaoCai","name":"面条菜"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"SiGuaJian","name":"丝瓜尖"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"HongShuYe","name":"红薯叶"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"NanGuaHua","name":"南瓜花"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"NanGuaYe","name":"南瓜叶"},{"category_id":"scgg","category_name":"蔬菜瓜果","category_sub_id":"njyhc","category_sub_name":"嫩茎叶花菜类","short_name":"TaiJu","name":"胎菊"}];
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
