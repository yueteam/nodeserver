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
        var scArr = [{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"HongShuDianFen","name":"红薯淀粉"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"BaJiao","name":"八角"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"BaiCu","name":"白醋"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"BaiHuJiao","name":"白胡椒"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"BaiJiangYou","name":"白酱油"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"ChenCu","name":"陈醋"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"CongYou","name":"葱油"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"CuYan","name":"粗盐"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"Cu","name":"醋"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"CuJing","name":"醋精"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"JieMoJiang","name":"芥末酱"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"DouBan","name":"豆瓣"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"DouBanJiang","name":"豆瓣酱"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"DouBanLaJiang","name":"豆瓣辣酱"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"DouChi","name":"豆豉"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"FanQieJiang","name":"番茄酱"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"FanQieShaSi","name":"番茄沙司"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"FanQieLaJiang","name":"番茄辣酱"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"FanQieZhi","name":"番茄汁"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"FengMi","name":"蜂蜜"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"FuRu(Bai)","name":"腐乳(白)"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"FuRu(Hong)","name":"腐乳(红)"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"FuRu(Chou)","name":"腐乳(臭)"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"HuaJiaoHuaJiao","name":"花椒"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"CaiZiYou","name":"菜籽油"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"HuMaYou","name":"胡麻油"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"YangYou","name":"羊油"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"HuJiaoFen","name":"胡椒粉"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"TiaoHeYou","name":"调和油"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"DingXiang","name":"丁香"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"HeTaoYou","name":"核桃油"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"DaMaYou","name":"大麻油"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"YeZiYou","name":"椰子油"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"HuiXiangZi","name":"茴香籽"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"ZongLvYou","name":"棕榈油"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"JieMo","name":"芥茉"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"PuTangZiYou","name":"葡萄籽油"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"GanHuaJiaoYe","name":"干花椒叶"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"KeKeFen","name":"可可粉"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"KuiHuaZiYou","name":"葵花籽油"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"MoChaFen","name":"抹茶粉"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"YaMaZiYou","name":"亚麻籽油"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"XiangCao","name":"香草"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"XingRenYou","name":"杏仁油"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"DaoMiyou","name":"稻米油"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"ZhiMaJiang","name":"芝麻酱"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"RouGuiFen","name":"肉桂粉"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"XiangGuJiang","name":"香菇酱"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"MiDieXiang","name":"迷迭香"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"HuangDouJiang","name":"黄豆酱"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"QianDaoJiang","name":"千岛酱"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"BaiShaTang","name":"白砂糖"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"YuMiDianFen","name":"玉米淀粉"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"HongTang","name":"红糖"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"ShaLaJiang","name":"沙拉酱"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"BingTang","name":"冰糖"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"MianBaiTang","name":"绵白糖"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"NingMengCao","name":"柠檬草"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"TangFen","name":"糖粉"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"HeiHuJiaoJiang","name":"黑胡椒酱"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"XiShaTang","name":"细砂糖"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"NiuRouJiang","name":"牛肉酱"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"TangJiang","name":"糖浆"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"LaJiaoJiang","name":"辣椒酱"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"ZheTang","name":"蔗糖"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"HuaShengJiang","name":"花生酱"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"BoHe","name":"薄荷"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"YiFenJiang","name":"意粉酱"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"TianMianJiang","name":"甜面酱"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"YiMianJiang","name":"意面酱"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"ZhenZhuTang","name":"珍珠糖"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"HuangTang","name":"黄糖"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"MaYou","name":"麻油"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"XiangYou","name":"香油"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"ZhiMaYou","name":"芝麻油"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"YuLu","name":"鱼露"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"HaoYou","name":"蚝油"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"HuaJiaoYou","name":"花椒油"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"LaJiaoYou","name":"辣椒油"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"HuaShengYou","name":"花生油"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"DouYou","name":"豆油"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"NiuYou","name":"牛油"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"YuMiYou","name":"玉米油"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"SeLaYou","name":"色拉油"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"SuanRongJiang","name":"蒜蓉酱"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"GanLanYou","name":"橄榄油"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"XiaJiang","name":"虾酱"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"QiaoKeLiJiang","name":"巧克力酱"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"XunYiCao","name":"薰衣草"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"GanLanJiang","name":"橄榄酱"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"JiangYou","name":"酱油"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"LaoZao","name":"醪糟"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"JingYan","name":"精盐"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"HuYan","name":"湖盐"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"WeiJing","name":"味精"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"JiJing","name":"鸡精"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"GanHuangJiang","name":"干黄酱"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"RouDouKou","name":"肉豆蔻"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"RouGui","name":"肉桂"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"GanJiang","name":"干姜"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"ShuiJingTang","name":"水晶糖"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"ShiYongSeSu","name":"食用色素"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"SuRongJiaoMu","name":"速溶酵母"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"ShanJiaoFen","name":"山椒粉"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"ShuiMaiYa","name":"水麦芽"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"KuiHuaYou","name":"葵花油"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"ShengFen","name":"生粉"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"ShengChou","name":"生抽"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"BaiYou","name":"白油"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"BanJiaoYou","name":"板绞油"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"ShanKui","name":"山葵"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"BaoZaiJiang","name":"煲仔酱"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"BaiHuJiaoFen","name":"白胡椒粉"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"CanDouDianFen","name":"蚕豆淀粉"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"CaoDouKou","name":"草豆蔻"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"CaoGuo","name":"草果"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"CongKaoJiang","name":"葱烤酱"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"DuoJiao","name":"剁椒"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"TaTaFen","name":"塔塔粉"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"TangShuang","name":"糖霜"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"MuYuJing","name":"木鱼精"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"MiCu","name":"米醋"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"MianZiYou","name":"棉籽油"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"MianChi","name":"面豉"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"WuCu","name":"乌醋"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"WuXiangFen","name":"五香粉"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"DianFen","name":"淀粉"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"HeiSuan","name":"黑蒜"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"XiangCaoFen","name":"香草粉"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"XiangYe","name":"香叶"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"MeiRouJiang","name":"梅肉酱"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"MaQiLin","name":"玛琪琳"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"XiaoSuDa","name":"小苏打"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"PaoDaFen","name":"泡打粉"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"YuYou","name":"鱼油"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"QingHuaJiao","name":"青花椒"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"YeZiFen","name":"椰子粉"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"YuJinXiangFen","name":"郁金香粉"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"DaCong","name":"大葱"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"YeJu","name":"野菊"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"YaYou","name":"鸭油"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"ZhiWuYou","name":"植物油"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"ZhuTanFen","name":"竹炭粉"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"MaiYaTang","name":"麦芽糖"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"LvChaFen","name":"绿茶粉"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"XiangCaoJing","name":"香草精"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"QQTang","name":"QQ糖"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"XiaoMaiDianFen","name":"小麦淀粉"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"FengTangJiang","name":"枫糖浆"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"GaLi","name":"咖喱"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"GuiPi","name":"桂皮"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"GaLiFen","name":"咖喱粉"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"GuiPiFen","name":"桂皮粉"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"GaoLiangJiang","name":"高良姜"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"GuiHuaMi","name":"桂花蜜"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"GuiZhi","name":"桂枝"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"GuoDongFen","name":"果冻粉"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"GuoTang","name":"果糖"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"HeiHuJiao","name":"黑胡椒"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"HeiMaYou","name":"黑麻油"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"HaiDanJiang","name":"海胆酱"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"HeiTang","name":"黑糖"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"HuJiaoMian","name":"胡椒面"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"HongGaLiJiang","name":"红咖喱酱"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"HongQu","name":"红曲"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"HeiJie","name":"黑芥"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"DaSuan","name":"大蒜"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"XianJiang","name":"鲜姜"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"FaXiang","name":"法香"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"JvJv","name":"菊苣"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"SHENGJIANG","name":"生姜"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"Yan","name":"盐"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"LiaoJiu","name":"料酒"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"LaoChou","name":"老抽"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"GanLaJiao","name":"干辣椒"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"Cong","name":"葱"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"HaiYan","name":"海盐"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"ZiRan","name":"孜然"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"ShiYongYou","name":"食用油"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"XiaoMiJiao","name":"小米椒"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"XiangCu","name":"香醋"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"PaoJiao","name":"泡椒"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"NeiZhi","name":"内酯"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"ZhengYuChiYou","name":"蒸鱼豉油"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"MianHuaTang","name":"棉花糖"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"JiaoMuFen","name":"酵母粉"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"ShiSanXiang","name":"十三香"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"LaJiaoFen","name":"辣椒粉"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"JiLiDing","name":"吉利丁"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"JiaoYan","name":"椒盐"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"MianBaoKang","name":"面包糠"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"MuShuDianFen","name":"木薯淀粉"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"JiangFen","name":"姜粉"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"XiaoHuiXiang","name":"小茴香"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"HongQuFen","name":"红曲粉"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"DanHuangJiang","name":"蛋黄酱"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"ChengPi","name":"橙皮"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"HuaJiaoFen","name":"花椒粉"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"ZhuanHuaTangJiang","name":"转化糖浆"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"JianShui","name":"枧水"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"GuoCu","name":"果醋"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"YeRong","name":"椰蓉"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"BuDingFen","name":"布丁粉"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"HuangJiu","name":"黄酒"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"JiZhi","name":"鸡汁"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"ShaRen","name":"砂仁"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"PiXianDouBanJiang","name":"郫县豆瓣酱"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"TianJiuQu","name":"甜酒曲"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"BaoYuZhi","name":"鲍鱼汁"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"LaoGanMa","name":"老干妈"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"ShaChaJiang","name":"沙茶酱"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"TangGuiHua","name":"糖桂花"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"MaJiao","name":"麻椒"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"YouPoLaZi","name":"油泼辣子"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"ShouSiCu","name":"寿司醋"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"GaoTang","name":"高汤"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"WeiLin","name":"味啉"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"PiSaJiang","name":"披萨酱"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"TaiJiao","name":"泰椒"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"XiaYou","name":"虾油"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"LaoBingTang","name":"老冰糖"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"JiangZhi","name":"姜汁"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"LuZhi","name":"卤汁"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"LaBaSuan","name":"腊八蒜"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"JiShiFen","name":"吉士粉"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"ZhuHouJiang","name":"柱候酱"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"PaoJiang","name":"泡姜"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"WeiZeng","name":"味增"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"ChaShaoJiang","name":"叉烧酱"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"ShanChaYou","name":"山茶油"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"YouChaZiYou","name":"油茶籽油"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"ZhuYou","name":"猪油"},{"category_id":"twp","category_name":"调味品","category_sub_id":"twp","category_sub_name":"调味品","short_name":"ChaYou","name":"茶油"}];
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
