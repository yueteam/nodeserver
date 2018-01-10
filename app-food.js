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
            var result = yield client.putStream(id+'.png', stream);
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
        collection.find({open_id: userInfo.open_id}).toArray(function(err, items){        
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

app.get('/getnews2', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");

    MongoClient.connect(DB_CONN_STR, function(err, db) { 
        var collection = db.collection('news');
        collection.insertMany([{
            title: '女性常吃西红柿的7大好处',
            summary: '西红柿富含丰富的营养，无论是生吃还是作为配菜，西红柿的营养价值都是很高的，那么具体吃西红柿有哪些好处呢？女人常吃西红柿又有哪些好处呢？',
            cover: {
                cover_img: 'https://foodcover.oss-cn-hangzhou.aliyuncs.com/6fa712dc968a060b89ed9e6410dfd7da.jpg',
                cover_width: '640',
                cover_height: '480'
            },
            tag: '知食',
            source: 'mstx',
            rich_content: [
                {
                    "type" : "title",
                    "content" : "女性吃西红柿的好处"
                },{
                    "type" : "title",
                    "content" : "1、降脂降压"
                },
                {
                    "type" : "text",
                    "content" : "降脂降压，利尿排钠。西红柿所含维生素C、芦丁、番茄红素及果酸，可降低血胆固醇，预防动脉粥样硬化及冠心病。另含有大量的钾及碱性矿物质，能促进血中钠盐的排出，有降压、利尿、消肿作用，对高血压、肾脏病有良好的辅助治疗作用。"
                },{
                    "type" : "title",
                    "content" : "2、健胃消食"
                },
                {
                    "type" : "text",
                    "content" : "健胃消食，润肠通便所含苹果酸、柠檬酸等有机酸，能促使胃液分泌，增加胃酸浓度，调整胃肠功能，有助胃肠疾病的康复。所含果酸及纤维素，有助消化、润肠通便作用，可防治便秘。"
                },
                {
                    "type" : "text",
                    "content" : "西红柿是胆固醇患者以及高血压患者的一道良菜，高血压患者日常可多食用一些西红柿，以控制血压。西红柿的好处可不止这些，一起接着往下看吧。"
                },{
                    "type" : "title",
                    "content" : "3、清热解毒"
                },
                {
                    "type" : "text",
                    "content" : "清热解毒，生津止渴西红柿性凉味甘酸，有清热生津、养阴凉血的功效，对发热烦渴、口干舌燥、牙龈出血、胃热口苦、虚火上升有较好治疗效果。"
                },{
                    "type" : "title",
                    "content" : "4、防癌抗癌"
                },
                {
                    "type" : "text",
                    "content" : "防癌抗癌、延缓衰。老近年来，研究证实西红柿中所含番茄红素具有独特的抗氧化作用，可清除体内的自由基，预防心血管疾病的发生，有效地减少胰腺癌、直肠癌、口腔癌、乳腺癌的发生，阻止前列腺癌变的进程。西红柿还含有防癌抗衰老的谷胱甘肽，可清除体内有毒物质，恢复机体器官正常功能，延缓衰老，故西红柿拥有“长寿果”之美誉。"
                },{
                    "type" : "title",
                    "content" : "5、抗血凝聚"
                },
                {
                    "type" : "text",
                    "content" : "抗血凝聚、防脑血栓。国外研究发现，从番茄籽周围黄色果冻状的汁液中分离出来了一种被称为P3的物质，具有抗血小板凝聚的功效，可以防止脑血栓的发生。患冠心病及中风的病人每天适量饮用番茄汁有益于病的康复。"
                },{
                    "type" : "title",
                    "content" : "6、保护视力"
                },
                {
                    "type" : "text",
                    "content" : "防白内障黄斑变性所含维生素A、C，可预防白内障，还对夜盲症有一定防治效果；番茄红素具有抑制脂质过氧化的作用，能防止自由基的破坏，抑制视网膜黄斑变性，维护视力。"
                },{
                    "type" : "title",
                    "content" : "7、美容护肤"
                },
                {
                    "type" : "text",
                    "content" : "治皮肤病番茄含胡萝卜素和维生素A、C，有祛雀斑、美容、护肤等功效；治真菌、感染性皮肤病。另一项研究显示，番茄汁还对消除狐臭有一定作用。"
                },{
                    "type" : "title",
                    "content" : "西红柿什么时候吃合适"
                },{
                    "type" : "title",
                    "content" : "西红柿饭后吃合适"
                },
                {
                    "type" : "text",
                    "content" : "西红柿是寒性食物，空腹吃容易导致脾胃的虚寒，降低其消化功能，而在饭后吃则是能促进胃酸的分泌，帮助消化。"
                },{
                    "type" : "title",
                    "content" : "西红柿吃多少合适"
                },
                {
                    "type" : "text",
                    "content" : "为了避免食用过多西红柿给身体带来伤害，一天吃1-2个就可以了，也是能满足身体对其营养的需求。"
                },{
                    "type" : "title",
                    "content" : "吃西红柿的注意事项"
                },
                {
                    "type" : "text",
                    "content" : "1、西红柿食用时PH是偏低的，且含有较多植物酸，胃功能不好的人群不宜食用。"
                },
                {
                    "type" : "text",
                    "content" : "2、未成熟的西红柿是不宜食用的，含有有毒物质番茄碱，摄入过多会使人中毒"
                },
                {
                    "type" : "text",
                    "content" : "3、西红柿食用过多会引起身体的不适，吃的时候要控制好食用量，不要多吃。"
                },
                {
                    "type" : "text",
                    "content" : "4、西红柿性凉，寒性体质的人群和经期女性不要过多食用，以免体内寒气加重。"
                }
            ],
            create_time: Date.now()+8*3600*1000
        },{
            title: '山药不仅能补肾，还有这种功效！',
            summary: '山药味甘、性平、无毒，归脾、肺、肾经。古书《本草纲目》中记载，山药有补中益气，强筋健脾等滋补功效。生活中有很多人都爱吃山药，女性经常吃山药可以滋阴补肾、延缓衰老。除此之外，山药还有哪些好处呢？',
            cover: {
                cover_img: 'https://foodcover.oss-cn-hangzhou.aliyuncs.com/bc8be644efab1e87da1f890799c3b253.jpg',
                cover_width: '500',
                cover_height: '352'
            },
            tag: '知食',
            source: 'mstx',
            rich_content: [
                {
                    "type" : "title",
                    "content" : "1、增强免疫力"
                },
                {
                    "type" : "text",
                    "content" : "山药中含有多种维生素，能够缓解人体脂质代谢异常，迅速清除人体内产生的垃圾。还能增强免疫力、预防疾病。山药还含有多种矿物质，比如铁、铜、锌、锰、钙等多种微量元素，能够补铁补钙补锌。"
                },{
                    "type" : "title",
                    "content" : "2、养颜美容"
                },
                {
                    "type" : "text",
                    "content" : "山药含有多种丰富的氨基酸等物质，例如自由氨基酸、多酚氧化酶、维生素C、碘质、16种氨基酸。氨基酸可以修复破损细胞、破损因子等，所以有很好的养颜作用。"
                },{
                    "type" : "title",
                    "content" : "3、降血压"
                },
                {
                    "type" : "text",
                    "content" : "中药六味地黄丸、八味地黄丸、归芍地黄丸等这些大家很熟悉的药品，都添加了山药作为药剂，山药不但可以用于治疗肾虚病症，还可以治疗哮喘、糖尿病、高血压、神经衰弱和腰痛等病症。"
                },{
                    "type" : "title",
                    "content" : "4、抗肿瘤作用"
                },
                {
                    "type" : "text",
                    "content" : "山药块茎含有很多糖分，对人类免疫系统有刺激和调节作用。因此是一种很好的调节免疫力的保健品。山药多糖对环磷酰胺所导致的细胞免疫抑制有对抗作用，能使被抑制的细胞免疫功能部分或全部恢复正常。山药还能促进白细胞的吞噬作用。比如：归芍地黄丸可治疗耳痛耳鸣，阴虚自汗，知柏地黄丸可治疗强直性脊椎炎和妇科胎漏、阴痒、经闭等阴虚火旺症。六味地黄丸可治疗慢性肾炎、高血压、糖尿病、神经衰弱等病症。"
                },{
                    "type" : "title",
                    "content" : "5、延缓衰老"
                },
                {
                    "type" : "text",
                    "content" : "科学研究证明，山药能使加速有机体衰老的酶活性降低。含山药的八味地黄丸，主治产后虚汗不止。保元清降汤、保元寒降汤，可治吐血和鼻出血；寒淋汤和膏淋汤，可治淋虫。山药还可治肺结核、伤寒及妇女病等，这都有利于延年益寿。"
                },{
                    "type" : "title",
                    "content" : "6、可治皮肤病"
                },
                {
                    "type" : "text",
                    "content" : "山药中含有尿囊素，有麻醉镇痛的作用，能够加速上皮生长、消炎和抑菌，常被用来治疗手足皲裂、鱼鳞病和多种角化性皮肤病。"
                }
            ],
            create_time: Date.now()+9*3600*1000
        },{
            title: '减肥一直不成功可能是体质问题',
            summary: '通常易胖体质的人都是新陈代谢慢，睡眠不足，常常有口干舌燥的现象，尿液少而且偏黄，经常便秘，身体常有水肿的现象，喜欢喝冷饮，肌肉结实肥厚。根据这些现象就可以判断一下你是否是易胖体质。',
            cover: {
                cover_img: 'https://foodcover.oss-cn-hangzhou.aliyuncs.com/a9e8898b14fea62e43f7cd446e405eb9.jpg',
                cover_width: '500',
                cover_height: '334'
            },
            tag: '瘦身',
            source: 'mstx',
            rich_content: [
                {
                    "type" : "text",
                    "content" : "然而易瘦体质也并不是天生的，而是后天形成的。那么你知道怎么样把你的体质改变成易瘦体质吗?"
                },{
                    "type" : "text",
                    "content" : "首先来了解一下怎么又易胖体质变成易瘦体质："
                },
                {
                    "type" : "title",
                    "content" : "扭转身体"
                },{
                    "type" : "text",
                    "content" : "坐在椅子上，上半身左右大幅度扭转的运动对于提升代谢力来说非常推荐。通过腰部的扭转，自然而然成为易瘦体质。"
                },
                {
                    "type" : "title",
                    "content" : "让右脚踝纤细起来"
                },{
                    "type" : "text",
                    "content" : "左右两个脚踝的粗细度不但受到耻骨的影响，也关系到荷尔蒙的分泌。右脚踝比左脚踝粗的人食欲更为旺盛。多推揉右脚踝有助于变瘦。"
                },
                {
                    "type" : "title",
                    "content" : "让身体多多运动"
                },{
                    "type" : "text",
                    "content" : "想要瘦的话就必须多运动身体。单单减少食量，只会让肌肉变少并使代谢力下降，更容易变成难瘦的体质。"
                },
                {
                    "type" : "title",
                    "content" : "大幅度的旋转头部"
                },{
                    "type" : "text",
                    "content" : "通过转头的动作，能产生热量并促进褐色脂肪细胞的活发。这种细胞活发后能够让代谢能力旺盛起来，从而变成不易长胖的体质。"
                },
                {
                    "type" : "title",
                    "content" : "饮食正常"
                },{
                    "type" : "text",
                    "content" : "同时我们应该要注意三餐饮食的正常，但是要注意的是以清淡为主，少油少盐，注意营养均衡。"
                },
                {
                    "type" : "title",
                    "content" : "睡前泡澡"
                },{
                    "type" : "text",
                    "content" : "睡前来泡澡，可以让身体更快地瘦下去，水温在夏天37度左右，冬天在39度左右，可以让身体的内循环加快，泡澡时间最好控制在30分钟内，可以让你的睡眠质量更加好，还可以有助于减肥。"
                },
                {
                    "type" : "title",
                    "content" : "多喝水"
                },{
                    "type" : "text",
                    "content" : "我们应该要多喝水，多喝水才可以加快你的新陈代谢，使身体的排毒功能能可以更好地排出毒素，改善身体的毒素积累，这样就可以让身体处在一个更健康的身体环境当中。"
                },{
                    "type" : "title",
                    "content" : "晚上吃肉"
                },{
                    "type" : "text",
                    "content" : "如果你是一个特别喜欢吃肉的人，最好选择在中午吃肉，因为在一天当中下午消耗的能量或许是最多的，然而如果你选择在晚上吃肉的话，消耗不玩能量就会转化为脂肪，这样更加不利于减肥。"
                },{
                    "type" : "title",
                    "content" : "睡眠充足"
                },{
                    "type" : "text",
                    "content" : "我们应该要改善自己的睡眠，睡眠时间至少要控制在7到8个小时左右，这样的话才能更好地达到良好的精神状态，不要熬夜，身体在23点至1点的这个时段身体的内脏正在进行排毒，应该处于睡眠状态，这样才能更好地达到排毒的效果，如果此时你还在工作或者是熬夜做别的事情对于身体没有一点好处。"
                },{
                    "type" : "text",
                    "content" : "很多的易胖体质都是酸性体质，它不单只会导致肥胖，还很容易导致其他的并发症，那就是酸性体质更容易得病，特别是得一些不好的疾病，例如癌症等一些可怕的疾病。"
                }
            ],
            create_time: Date.now()+10*3600*1000
        }], function(error, result) { 
            res.json({code: successCode, msg: ""}); 
            db.close();
        });
    });
});

app.get('/getnews', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");

    var pageNo = parseInt(req.query.pageNo);
    var userId = req.query.userId;
    var skipCount = (pageNo-1)*10;
    MongoClient.connect(DB_CONN_STR, function(err, db) {
        var collection = db.collection('news');
        collection.find({source:{$ne:"hema"}}, {rich_content: 0}).sort({'create_time':-1}).limit(10).skip(skipCount).toArray(function(err, items){        
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

app.get('/souxiangke', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");

    var name = req.query.name;
    MongoClient.connect(DB_CONN_STR, function(err, db) {
        var collection = db.collection('xiangke');
        collection.findOne({name: name}, function(err1, item){        
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

var options = {
    key: fs.readFileSync('./keys/214248838510598.key'),
    cert: fs.readFileSync('./keys/214248838510598.pem')
};
https.createServer(options, app).listen(3000, function(req, res){
    console.log('server is running on port 3000');
});
