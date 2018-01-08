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
        var scArr = [{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mi","category_sub_name":"米类","short_name":"DaMi","name":"大米"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mi","category_sub_name":"米类","short_name":"NuoMi","name":"糯米"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mi","category_sub_name":"米类","short_name":"HeiMi","name":"黑米"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mi","category_sub_name":"米类","short_name":"XiaoMai","name":"小麦"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mi","category_sub_name":"米类","short_name":"XiaoMi","name":"小米"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mi","category_sub_name":"米类","short_name":"QiaoMaiMi","name":"荞麦米"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mi","category_sub_name":"米类","short_name":"YuMi","name":"玉米"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mi","category_sub_name":"米类","short_name":"XiMi","name":"西米"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mi","category_sub_name":"米类","short_name":"YiMi","name":"薏米"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mi","category_sub_name":"米类","short_name":"YanMai","name":"燕麦"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mi","category_sub_name":"米类","short_name":"GaoLiang","name":"高粱"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mi","category_sub_name":"米类","short_name":"QianShi","name":"芡实"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mi","category_sub_name":"米类","short_name":"CaoMi","name":"糙米"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mi","category_sub_name":"米类","short_name":"ZiMi","name":"紫米"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mi","category_sub_name":"米类","short_name":"HeiNuoMi","name":"黑糯米"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mi","category_sub_name":"米类","short_name":"HongMi","name":"红米"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mi","category_sub_name":"米类","short_name":"HuangMi","name":"黄米"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mi","category_sub_name":"米类","short_name":"GengMi","name":"粳米"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mi","category_sub_name":"米类","short_name":"YuMiShen","name":"玉米糁"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mi","category_sub_name":"米类","short_name":"TaiGuoXiangMi","name":"泰国香米"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mi","category_sub_name":"米类","short_name":"ShouSiMi","name":"寿司米"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mi","category_sub_name":"米类","short_name":"XieNuoMi","name":"血糯米"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mi","category_sub_name":"米类","short_name":"DaMai","name":"大麦"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mi","category_sub_name":"米类","short_name":"GaoLiangMi","name":"高粱米"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mi","category_sub_name":"米类","short_name":"XianMi","name":"籼米"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mi","category_sub_name":"米类","short_name":"QiaoMai","name":"荞麦"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mi","category_sub_name":"米类","short_name":"XiangMi","name":"香米"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mi","category_sub_name":"米类","short_name":"MiFan","name":"米饭"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mi","category_sub_name":"米类","short_name":"SuMi","name":"粟米"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mi","category_sub_name":"米类","short_name":"JiangMi","name":"江米"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mi","category_sub_name":"米类","short_name":"SiMiaoMi","name":"丝苗米"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mi","category_sub_name":"米类","short_name":"ShanLanMi","name":"山兰米"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mi","category_sub_name":"米类","short_name":"ChangMi","name":"长米"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mi","category_sub_name":"米类","short_name":"ChangNuoMi","name":"长糯米"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mi","category_sub_name":"米类","short_name":"ZaoJiaoMi","name":"皂角米"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mi","category_sub_name":"米类","short_name":"Mei","name":"糜（糜子）"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mi","category_sub_name":"米类","short_name":"PeiYaMi","name":"胚芽米"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mi","category_sub_name":"米类","short_name":"PengLaiMi","name":"蓬莱米"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mi","category_sub_name":"米类","short_name":"QingKe","name":"青稞"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mi","category_sub_name":"米类","short_name":"QianShiMi","name":"芡实米"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mi","category_sub_name":"米类","short_name":"DaoMi","name":"稻米"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mi","category_sub_name":"米类","short_name":"YueGuangMi","name":"越光米"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mi","category_sub_name":"米类","short_name":"YeMi","name":"野米"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mi","category_sub_name":"米类","short_name":"yanmi","name":"岩米"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mi","category_sub_name":"米类","short_name":"YinMi","name":"阴米"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mi","category_sub_name":"米类","short_name":"JiTouMi","name":"鸡头米"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mi","category_sub_name":"米类","short_name":"GuMi","name":"菰米"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mi","category_sub_name":"米类","short_name":"HongQuMi","name":"红曲米"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mi","category_sub_name":"米类","short_name":"HongYiMi","name":"红薏米"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mian","category_sub_name":"面粉","short_name":"BaiMian","name":"白面"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mian","category_sub_name":"面粉","short_name":"NianMiFen","name":"粘米粉"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mian","category_sub_name":"面粉","short_name":"QiaoMaiMianFen","name":"荞麦面粉"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mian","category_sub_name":"面粉","short_name":"OuFen","name":"藕粉"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mian","category_sub_name":"面粉","short_name":"YuMiMian","name":"玉米面"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mian","category_sub_name":"面粉","short_name":"NuoMiFen","name":"糯米粉"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mian","category_sub_name":"面粉","short_name":"MianTiao","name":"面条"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mian","category_sub_name":"面粉","short_name":"YouMaiMian","name":"莜麦面"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mian","category_sub_name":"面粉","short_name":"HuangDouMian","name":"黄豆面"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mian","category_sub_name":"面粉","short_name":"QiaoMaiMian","name":"荞麦面"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mian","category_sub_name":"面粉","short_name":"GaoJinMianFen","name":"高筋面粉"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mian","category_sub_name":"面粉","short_name":"ZhongJinMianFen","name":"中筋面粉"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mian","category_sub_name":"面粉","short_name":"DiJinMianFen","name":"低筋面粉"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mian","category_sub_name":"面粉","short_name":"XiaoMiMian","name":"小米面"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mian","category_sub_name":"面粉","short_name":"QuanMaiMianFen","name":"全麦面粉"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mian","category_sub_name":"面粉","short_name":"HuangMiMian","name":"黄米面"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mian","category_sub_name":"面粉","short_name":"SuFen","name":"粟粉"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mian","category_sub_name":"面粉","short_name":"SuDaFen","name":"苏打粉"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mian","category_sub_name":"面粉","short_name":"XiaoMaiFen","name":"小麦粉"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mian","category_sub_name":"面粉","short_name":"LiMai","name":"藜麦"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mian","category_sub_name":"面粉","short_name":"MaiRen","name":"麦仁"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mian","category_sub_name":"面粉","short_name":"MiXingMian","name":"米形面"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mian","category_sub_name":"面粉","short_name":"NanGuaFen","name":"南瓜粉"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mian","category_sub_name":"面粉","short_name":"XingRenFen","name":"杏仁粉"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mian","category_sub_name":"面粉","short_name":"ChengFen","name":"澄粉"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mian","category_sub_name":"面粉","short_name":"FuQiangFen","name":"富强粉"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mian","category_sub_name":"面粉","short_name":"GaoLiangMian","name":"高粱面"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mian","category_sub_name":"面粉","short_name":"GuoFen","name":"裹粉"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mian","category_sub_name":"面粉","short_name":"GeGenFen","name":"葛根粉"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mian","category_sub_name":"面粉","short_name":"HeiMaiFen","name":"黑麦粉"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mian","category_sub_name":"面粉","short_name":"YouSu","name":"油酥"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mian","category_sub_name":"面粉","short_name":"JiaoZiFen","name":"饺子粉"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mian","category_sub_name":"面粉","short_name":"MaiXinFen","name":"麦芯粉"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mian","category_sub_name":"面粉","short_name":"MianBaoFen","name":"面包粉"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"mian","category_sub_name":"面粉","short_name":"HeiMiMian","name":"黑米面"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"dou","category_sub_name":"豆类","short_name":"HeiDou","name":"黑豆"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"dou","category_sub_name":"豆类","short_name":"XiaoDou","name":"小豆"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"dou","category_sub_name":"豆类","short_name":"HongDou","name":"红豆"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"dou","category_sub_name":"豆类","short_name":"LvDou","name":"绿豆"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"dou","category_sub_name":"豆类","short_name":"QingDou","name":"青豆"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"dou","category_sub_name":"豆类","short_name":"HuangDou","name":"黄豆"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"dou","category_sub_name":"豆类","short_name":"HongYunDou","name":"红芸豆"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"dou","category_sub_name":"豆类","short_name":"HongYaoDou","name":"红腰豆"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"dou","category_sub_name":"豆类","short_name":"BaiDou","name":"白豆"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"dou","category_sub_name":"豆类","short_name":"BaiBianDou","name":"白扁豆"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"dou","category_sub_name":"豆类","short_name":"ChiXiaoDou","name":"赤小豆"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"dou","category_sub_name":"豆类","short_name":"MaYaDaDou","name":"马牙大豆"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"dou","category_sub_name":"豆类","short_name":"XiaoYuanDou","name":"小圆豆"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"dou","category_sub_name":"豆类","short_name":"XuSongNaDou","name":"旭松纳豆"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"dou","category_sub_name":"豆类","short_name":"BaiYunDou","name":"白芸豆"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"dou","category_sub_name":"豆类","short_name":"DaDou","name":"大豆"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"dou","category_sub_name":"豆类","short_name":"YingZuiDou","name":"鹰嘴豆"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"dou","category_sub_name":"豆类","short_name":"MiDou","name":"蜜豆"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"dou","category_sub_name":"豆类","short_name":"MeiDou","name":"眉豆"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"dzp","category_sub_name":"豆制品","short_name":"BaiYeJie","name":"百叶结"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"dzp","category_sub_name":"豆制品","short_name":"NenDouFu","name":"嫩豆腐"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"dzp","category_sub_name":"豆制品","short_name":"NeiZhiDouFu","name":"内酯豆腐"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"dzp","category_sub_name":"豆制品","short_name":"MiDouFu","name":"米豆腐"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"dzp","category_sub_name":"豆制品","short_name":"KaoFu","name":"烤麸"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"dzp","category_sub_name":"豆制品","short_name":"RiBenDouFu","name":"日本豆腐"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"dzp","category_sub_name":"豆制品","short_name":"DouZha","name":"豆渣"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"dzp","category_sub_name":"豆制品","short_name":"FuZhu","name":"腐竹"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"dzp","category_sub_name":"豆制品","short_name":"XunGan","name":"熏干"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"dzp","category_sub_name":"豆制品","short_name":"YunDou","name":"芸豆"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"dzp","category_sub_name":"豆制品","short_name":"DouGan","name":"豆干"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"dzp","category_sub_name":"豆制品","short_name":"XiangGan","name":"香干"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"dzp","category_sub_name":"豆制品","short_name":"ShanYaoDou","name":"山药豆"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"dzp","category_sub_name":"豆制品","short_name":"YouDouFu","name":"油豆腐"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"dzp","category_sub_name":"豆制品","short_name":"DouPi","name":"豆皮"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"dzp","category_sub_name":"豆制品","short_name":"DouFuGan","name":"豆腐干"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"dzp","category_sub_name":"豆制品","short_name":"DouFu","name":"豆腐"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"dzp","category_sub_name":"豆制品","short_name":"DongDouFu","name":"冻豆腐"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"dzp","category_sub_name":"豆制品","short_name":"SuJi","name":"素鸡"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"dzp","category_sub_name":"豆制品","short_name":"NanDouFu","name":"南豆腐"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"dzp","category_sub_name":"豆制品","short_name":"BeiDouFu","name":"北豆腐"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"dzp","category_sub_name":"豆制品","short_name":"YouDouPi","name":"油豆皮"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"dzp","category_sub_name":"豆制品","short_name":"QianZhang","name":"千张"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"dzp","category_sub_name":"豆制品","short_name":"DouJiang","name":"豆浆"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"dzp","category_sub_name":"豆制品","short_name":"DouPao","name":"豆泡"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"dzp","category_sub_name":"豆制品","short_name":"DouFuNao","name":"豆腐脑"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"dzp","category_sub_name":"豆制品","short_name":"BaiYe","name":"百页"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"dzp","category_sub_name":"豆制品","short_name":"BanDouFu","name":"板豆腐"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"dzp","category_sub_name":"豆制品","short_name":"QianYeDouFu","name":"千页豆腐"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"dzp","category_sub_name":"豆制品","short_name":"DouPo","name":"豆粕"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"dzp","category_sub_name":"豆制品","short_name":"DouFUPi","name":"豆腐皮"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"dzp","category_sub_name":"豆制品","short_name":"DouJin","name":"豆筋"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"dzp","category_sub_name":"豆制品","short_name":"JuanDouFu","name":"绢豆腐"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"ru","category_sub_name":"乳类","short_name":"DanNaiYou","name":"淡奶油"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"ru","category_sub_name":"乳类","short_name":"NaiYou","name":"奶油"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"ru","category_sub_name":"乳类","short_name":"NaiLao","name":"奶酪"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"ru","category_sub_name":"乳类","short_name":"QiaoKeLi","name":"巧克力"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"ru","category_sub_name":"乳类","short_name":"QiSi","name":"起司"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"ru","category_sub_name":"乳类","short_name":"SuanNai","name":"酸奶"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"ru","category_sub_name":"乳类","short_name":"NiuNai","name":"牛奶"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"ru","category_sub_name":"乳类","short_name":"HuangYou","name":"黄油"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"ru","category_sub_name":"乳类","short_name":"XianNaiYou","name":"鲜奶油"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"ru","category_sub_name":"乳类","short_name":"ZhiShi","name":"芝士"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"ru","category_sub_name":"乳类","short_name":"ZhiWuNaiYou","name":"植物奶油"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"ru","category_sub_name":"乳类","short_name":"DongWuNaiYou","name":"动物奶油"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"ru","category_sub_name":"乳类","short_name":"LianRu","name":"炼乳"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"ru","category_sub_name":"乳类","short_name":"NaiFen","name":"奶粉"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"ru","category_sub_name":"乳类","short_name":"BaiQiaoKeLi","name":"白巧克力"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"ru","category_sub_name":"乳类","short_name":"RuLao","name":"乳酪"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"ru","category_sub_name":"乳类","short_name":"TuoZhiNaiFen","name":"脱脂奶粉"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"ru","category_sub_name":"乳类","short_name":"MaRu","name":"马乳"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"ru","category_sub_name":"乳类","short_name":"NiuChuRu","name":"牛初乳"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"ru","category_sub_name":"乳类","short_name":"QuanZhiNiuNai","name":"全脂牛奶"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"ru","category_sub_name":"乳类","short_name":"YangNai","name":"羊奶"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"ru","category_sub_name":"乳类","short_name":"ZhiShiFen","name":"芝士粉"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"ru","category_sub_name":"乳类","short_name":"QiaoKeLiDou","name":"巧克力豆"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"ru","category_sub_name":"乳类","short_name":"MaSuLiLaZhiShi","name":"马苏里拉芝士"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"ru","category_sub_name":"乳类","short_name":"QuanZhiNaiFen","name":"全脂奶粉"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"ru","category_sub_name":"乳类","short_name":"DanNai","name":"淡奶"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"fbsp","category_sub_name":"方便食品","short_name":"GuaMian","name":"挂面"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"fbsp","category_sub_name":"方便食品","short_name":"KuanFen","name":"宽粉"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"fbsp","category_sub_name":"方便食品","short_name":"FenPi","name":"粉皮"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"fbsp","category_sub_name":"方便食品","short_name":"FenSi","name":"粉丝"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"fbsp","category_sub_name":"方便食品","short_name":"MiXian","name":"米线"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"fbsp","category_sub_name":"方便食品","short_name":"YiMian","name":"意面"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"fbsp","category_sub_name":"方便食品","short_name":"HeFen","name":"河粉"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"fbsp","category_sub_name":"方便食品","short_name":"FenTiao","name":"粉条"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"fbsp","category_sub_name":"方便食品","short_name":"MianBao","name":"面包"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"fbsp","category_sub_name":"方便食品","short_name":"YouMianJin","name":"油面筋"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"fbsp","category_sub_name":"方便食品","short_name":"TuSi","name":"吐司"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"fbsp","category_sub_name":"方便食品","short_name":"HongShuFen","name":"红薯粉"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"fbsp","category_sub_name":"方便食品","short_name":"JueGenFen","name":"蕨根粉"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"fbsp","category_sub_name":"方便食品","short_name":"NianGao","name":"年糕"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"fbsp","category_sub_name":"方便食品","short_name":"YuMiPian","name":"玉米片"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"fbsp","category_sub_name":"方便食品","short_name":"YanMaiPian","name":"燕麦片"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"fbsp","category_sub_name":"方便食品","short_name":"YiDaLiMian","name":"意大利面"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"fbsp","category_sub_name":"方便食品","short_name":"YouTiao","name":"油条"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"fbsp","category_sub_name":"方便食品","short_name":"YinDuFeiBing","name":"印度飞饼"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"fbsp","category_sub_name":"方便食品","short_name":"DanTaPi","name":"蛋挞皮"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"fbsp","category_sub_name":"方便食品","short_name":"JiaoZiPi","name":"饺子皮"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"fbsp","category_sub_name":"方便食品","short_name":"HunDunPi","name":"馄饨皮"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"fbsp","category_sub_name":"方便食品","short_name":"MiFen","name":"米粉"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"fbsp","category_sub_name":"方便食品","short_name":"BaiDouSha","name":"白豆沙"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"fbsp","category_sub_name":"方便食品","short_name":"BeiKeMian","name":"贝壳面"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"fbsp","category_sub_name":"方便食品","short_name":"TongXinFen","name":"通心粉"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"fbsp","category_sub_name":"方便食品","short_name":"WuLongMian","name":"乌龙面"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"fbsp","category_sub_name":"方便食品","short_name":"MianXian","name":"面线"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"fbsp","category_sub_name":"方便食品","short_name":"MiTaiMu","name":"米苔目"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"fbsp","category_sub_name":"方便食品","short_name":"DouSha","name":"豆沙"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"fbsp","category_sub_name":"方便食品","short_name":"LvDouSha","name":"绿豆沙"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"fbsp","category_sub_name":"方便食品","short_name":"WuDongMian","name":"乌冬面"},{"category_id":"mmdr","category_name":"米面豆乳","category_sub_id":"fbsp","category_sub_name":"方便食品","short_name":"LiangFen","name":"凉粉"}];
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
