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
    bucket: 'yueavatar'
});
var client1 = new OSS({
    region: 'oss-cn-hangzhou',
    accessKeyId: 'LTAIrUHBoHLwlUNY',
    accessKeySecret: 'OvuJdzBuziDOIQFRD4gbZXI1fDQ8qC',
    bucket: 'yueqrcode'
});
// 引入json解析中间件
var bodyParser = require('body-parser');
// 添加json解析
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: false}));

var MongoClient = require('mongodb').MongoClient;
var ObjectID = require('mongodb').ObjectID;
var DB_CONN_STR = 'mongodb://localhost:27017/yue'; 

var baseUrl = 'https://movie.douban.com';
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

app.get('/', function(req, res){
    res.send('<h1>约吗？</h1>');
});

app.get('/nowplaying', function(req, res){
    var city = req.query.city;
    var route = '/cinema/nowplaying/' + city + '/';
    res.header("Content-Type", "application/json; charset=utf-8");
    superagent.get(baseUrl+route)
    .charset('utf-8')
    .end(function (err, sres) {
        if (err) {
            console.log('ERR: ' + err);
            res.json({code: failCode, msg: err});
            return;
        }
        var $ = cheerio.load(sres.text);
        var dataObj = {},
            films = [],
            districts = [];
        $('#nowplaying .lists .list-item').each(function (idx, element) {
            if(idx < 15) {
                var $element = $(element),
                    $poster = $element.find('.poster img');
                films.push({
                    id: $element.attr('id'),
                    img : $poster.attr('src'),
                    title : $element.data('title'),
                    rate : $element.data('score'),
                    release: $element.data('release'),
                    duration: $element.data('duration'),
                    region: $element.data('region'),
                    director: $element.data('director'),
                    actors: $element.data('actors')
                });
            }
        });
        dataObj.filmList = films;   

        $('#districts .district-item').each(function (idx, element) {
            var $element = $(element);
            districts.push({
                id: $element.attr('id'),
                name: $element.text()
            });
        });
        dataObj.districtList = districts;    
        res.json({code: successCode, msg: "", data: dataObj});
    });
});

app.get('/getcinemas', function(req, res){
    var cityId = req.query.cityId;
    var districtId = req.query.districtId;
    res.header("Content-Type", "application/json; charset=utf-8");

    superagent.get('https://movie.douban.com/j/cinema/cinemas/?city_id='+cityId)
    .charset('utf-8')
    .end(function (err, sres) {
        if (err) {
            res.json({code: failCode, msg: err});
            return;
        }
        var list = JSON.parse(sres.text);
        res.json({code: successCode, msg: "", data: list});        
    });

});
app.get('/getdistrict', function(req, res){
    var cityJson = {'A':[{'id':'118190','uid':'anqing','name':'安庆'},{'id':'118244','uid':'anyang','name':'安阳'},{'id':'118125','uid':'anshan','name':'鞍山'},{'id':'118342','uid':'anshun','name':'安顺'},{'id':'118379','uid':'ankang','name':'安康'},{'id':'118421','uid':'aletai','name':'阿勒泰'},{'id':'118413','uid':'akesu','name':'阿克苏'},{'id':'118336','uid':'aba','name':'阿坝'}],'B':[{'id':'108288','uid':'beijing','name':'北京'},{'id':'118093','uid':'baoding','name':'保定'},{'id':'118373','uid':'baoji','name':'宝鸡'},{'id':'118235','uid':'binzhou','name':'滨州'},{'id':'118112','uid':'baotou','name':'包头'},{'id':'118185','uid':'bangbu','name':'蚌埠'},{'id':'118197','uid':'bozhou','name':'亳州'},{'id':'118344','uid':'bijie','name':'毕节'},{'id':'118306','uid':'beihai','name':'北海'},{'id':'118118','uid':'bayannaoer','name':'巴彦淖尔'},{'id':'118383','uid':'baiyin','name':'白银'},{'id':'118351','uid':'baoshan','name':'保山'},{'id':'118311','uid':'baise','name':'百色'},{'id':'118127','uid':'benxi','name':'本溪'},{'id':'118416','uid':'bayinguoleng','name':'巴音郭楞'},{'id':'118142','uid':'baishan','name':'白山'},{'id':'118144','uid':'baicheng','name':'白城'},{'id':'118334','uid':'bazhong','name':'巴中'},{'id':'131586','uid':'131586','name':'保亭'}],'C':[{'id':'108309','uid':'chongqing','name':'重庆'},{'id':'118318','uid':'chengdu','name':'成都'},{'id':'118267','uid':'changsha','name':'长沙'},{'id':'118137','uid':'changchun','name':'长春'},{'id':'118162','uid':'changzhou','name':'常州'},{'id':'118276','uid':'chenzhou','name':'郴州'},{'id':'118273','uid':'changde','name':'常德'},{'id':'118192','uid':'chuzhou','name':'滁州'},{'id':'118096','uid':'cangzhou','name':'沧州'},{'id':'118103','uid':'changzhi','name':'长治'},{'id':'118114','uid':'chifeng','name':'赤峰'},{'id':'118095','uid':'chengde','name':'承德'},{'id':'118135','uid':'chaoyang','name':'朝阳'},{'id':'118299','uid':'chaozhou','name':'潮州'},{'id':'118417','uid':'changji','name':'昌吉'},{'id':'118198','uid':'chizhou','name':'池州'},{'id':'118315','uid':'chongzuo','name':'崇左'},{'id':'118359','uid':'chuxiong','name':'楚雄'},{'id':'129306','uid':'129306','name':'常熟'},{'id':'131580','uid':'131580','name':'澄迈'},{'id':'131583','uid':'131583','name':'昌江'}],'D':[{'id':'118297','uid':'dongguan','name':'东莞'},{'id':'118124','uid':'dalian','name':'大连'},{'id':'118151','uid':'daqing','name':'大庆'},{'id':'118224','uid':'dongying','name':'东营'},{'id':'118322','uid':'deyang','name':'德阳'},{'id':'118233','uid':'dezhou','name':'德州'},{'id':'118100','uid':'datong','name':'大同'},{'id':'118360','uid':'dali','name':'大理'},{'id':'118128','uid':'dandong','name':'丹东'},{'id':'118331','uid':'dazhou','name':'达州'},{'id':'118391','uid':'dingxi','name':'定西'},{'id':'118361','uid':'dehong','name':'德宏'},{'id':'131433','uid':'danzhou','name':'儋州'},{'id':'131577','uid':'131577','name':'东方'},{'id':'118158','uid':'daxinganling','name':'大兴安岭'},{'id':'118363','uid':'diqing','name':'迪庆'}],'E':[{'id':'118266','uid':'enshi','name':'恩施'},{'id':'118116','uid':'eerduosi','name':'鄂尔多斯'},{'id':'118261','uid':'ezhou','name':'鄂州'}],'F':[{'id':'118286','uid':'foshan','name':'佛山'},{'id':'118200','uid':'fuzhou','name':'福州'},{'id':'118218','uid':'118218','name':'抚州'},{'id':'118193','uid':'fuyang','name':'阜阳'},{'id':'118126','uid':'fushun','name':'抚顺'},{'id':'118307','uid':'fangchenggang','name':'防城港'},{'id':'118131','uid':'fuxin','name':'阜新'}],'G':[{'id':'118281','uid':'guangzhou','name':'广州'},{'id':'118215','uid':'ganzhou','name':'赣州'},{'id':'118339','uid':'guiyang','name':'贵阳'},{'id':'118304','uid':'guilin','name':'桂林'},{'id':'118324','uid':'guangyuan','name':'广元'},{'id':'118330','uid':'guangan','name':'广安'},{'id':'118406','uid':'guyuan','name':'固原'},{'id':'118394','uid':'gannan','name':'甘南'},{'id':'118309','uid':'guigang','name':'贵港'},{'id':'118337','uid':'ganzi','name':'甘孜'}],'H':[{'id':'118172','uid':'hangzhou','name':'杭州'},{'id':'118183','uid':'hefei','name':'合肥'},{'id':'118146','uid':'haerbin','name':'哈尔滨'},{'id':'118291','uid':'huizhou','name':'惠州'},{'id':'118091','uid':'handan','name':'邯郸'},{'id':'118176','uid':'huzhou','name':'湖州'},{'id':'118316','uid':'haikou','name':'海口'},{'id':'118166','uid':'huaian','name':'淮安'},{'id':'118111','uid':'huhehaote','name':'呼和浩特'},{'id':'118270','uid':'hengyang','name':'衡阳'},{'id':'118263','uid':'huanggang','name':'黄冈'},{'id':'118294','uid':'heyuan','name':'河源'},{'id':'118236','uid':'heze','name':'菏泽'},{'id':'118117','uid':'hulunbeier','name':'呼伦贝尔'},{'id':'118255','uid':'huangshi','name':'黄石'},{'id':'118186','uid':'huainan','name':'淮南'},{'id':'118191','uid':'huangshan','name':'黄山'},{'id':'118357','uid':'honghe','name':'红河'},{'id':'118098','uid':'hengshui','name':'衡水'},{'id':'118278','uid':'huaihua','name':'怀化'},{'id':'118136','uid':'huludao','name':'葫芦岛'},{'id':'118377','uid':'hanzhong','name':'汉中'},{'id':'118156','uid':'heihe','name':'黑河'},{'id':'118188','uid':'huaibei','name':'淮北'},{'id':'118242','uid':'hebi','name':'鹤壁'},{'id':'118313','uid':'hechi','name':'河池'},{'id':'118312','uid':'hezhou','name':'贺州'},{'id':'118149','uid':'hegang','name':'鹤岗'},{'id':'118402','uid':'haixi','name':'海西'},{'id':'118396','uid':'haidong','name':'海东'},{'id':'118411','uid':'hami','name':'哈密'},{'id':'118183','uid':'hefei','name':'合肥'},{'id':'118399','uid':'118399','name':'海南'}],'J':[{'id':'118178','uid':'jinhua','name':'金华'},{'id':'118220','uid':'jinan','name':'济南'},{'id':'118175','uid':'jiaxing','name':'嘉兴'},{'id':'118287','uid':'jiangmen','name':'江门'},{'id':'118212','uid':'jiujiang','name':'九江'},{'id':'118228','uid':'jining','name':'济宁'},{'id':'118258','uid':'jingzhou','name':'荆州'},{'id':'118216','uid':'jian','name':'吉安'},{'id':'129059','uid':'jilin','name':'吉林'},{'id':'118300','uid':'jieyang','name':'揭阳'},{'id':'118106','uid':'jinzhong','name':'晋中'},{'id':'118241','uid':'jiaozuo','name':'焦作'},{'id':'118260','uid':'jingmen','name':'荆门'},{'id':'118104','uid':'jincheng','name':'晋城'},{'id':'118389','uid':'jiuquan','name':'酒泉'},{'id':'118129','uid':'jinzhou','name':'锦州'},{'id':'118210','uid':'jingdezhen','name':'景德镇'},{'id':'118154','uid':'jiamusi','name':'佳木斯'},{'id':'128517','uid':'jiyuan','name':'济源'},{'id':'118382','uid':'jinchang','name':'金昌'},{'id':'118148','uid':'jixi','name':'鸡西'},{'id':'118385','uid':'jiayuguan','name':'嘉峪关'},{'id':'108294','uid':'jilinsheng','name':'吉林'}],'K':[{'id':'118348','uid':'kunming','name':'昆明'},{'id':'118238','uid':'kaifeng','name':'开封'},{'id':'118409','uid':'kelamayi','name':'克拉玛依'},{'id':'118414','uid':'kashen','name':'喀什'},{'id':'131410','uid':'131410','name':'昆山'},{'id':'130313','uid':'130313','name':'开平'},{'id':'131410','uid':'131410','name':'昆山'}],'L':[{'id':'118232','uid':'linyi','name':'临沂'},{'id':'118381','uid':'lanzhou','name':'兰州'},{'id':'118239','uid':'luoyang','name':'洛阳'},{'id':'118109','uid':'linfen','name':'临汾'},{'id':'118182','uid':'lishui','name':'丽水'},{'id':'118097','uid':'langfang','name':'廊坊'},{'id':'118196','uid':'luan','name':'六安'},{'id':'118279','uid':'loudi','name':'娄底'},{'id':'118234','uid':'liaocheng','name':'聊城'},{'id':'118303','uid':'liuzhou','name':'柳州'},{'id':'118110','uid':'lvliang','name':'吕梁'},{'id':'118165','uid':'lianyungang','name':'连云港'},{'id':'118327','uid':'leshan','name':'乐山'},{'id':'118207','uid':'longyan','name':'龙岩'},{'id':'118247','uid':'luohe','name':'漯河'},{'id':'118321','uid':'luzhou','name':'泸州'},{'id':'118393','uid':'linxia','name':'临夏'},{'id':'118132','uid':'liaoyang','name':'辽阳'},{'id':'118340','uid':'liupanshui','name':'六盘水'},{'id':'118392','uid':'longnan','name':'陇南'},{'id':'118338','uid':'liangshan','name':'凉山'},{'id':'118314','uid':'laibin','name':'来宾'},{'id':'118364','uid':'lasa','name':'拉萨'},{'id':'118140','uid':'liaoyuan','name':'辽源'},{'id':'118353','uid':'lijiang','name':'丽江'},{'id':'118355','uid':'lincang','name':'临沧'},{'id':'118231','uid':'laiwu','name':'莱芜'},{'id':'131584','uid':'131584','name':'乐东'}],'M':[{'id':'118323','uid':'mianyang','name':'绵阳'},{'id':'118292','uid':'meizhou','name':'梅州'},{'id':'118289','uid':'maoming','name':'茂名'},{'id':'118187','uid':'maanshan','name':'马鞍山'},{'id':'118332','uid':'meishan','name':'眉山'},{'id':'118153','uid':'mudanjiang','name':'牡丹江'}],'N':[{'id':'118159','uid':'nanjing','name':'南京'},{'id':'118173','uid':'ningbo','name':'宁波'},{'id':'118164','uid':'nantong','name':'南通'},{'id':'118209','uid':'nanchang','name':'南昌'},{'id':'118302','uid':'nanning','name':'南宁'},{'id':'118328','uid':'nanchong','name':'南充'},{'id':'118249','uid':'nanyang','name':'南阳'},{'id':'118208','uid':'ningde','name':'宁德'},{'id':'118206','uid':'nanping','name':'南平'},{'id':'118326','uid':'neijiang','name':'内江'},{'id':'118362','uid':'nujiang','name':'怒江'}],'P':[{'id':'118240','uid':'pingdingshan','name':'平顶山'},{'id':'118202','uid':'putian','name':'莆田'},{'id':'118133','uid':'panjin','name':'盘锦'},{'id':'118211','uid':'pingxiang','name':'萍乡'},{'id':'118388','uid':'pingliang','name':'平凉'},{'id':'130880','uid':'puer','name':'普洱'},{'id':'118245','uid':'puyang','name':'濮阳'},{'id':'118320','uid':'panzhihua','name':'攀枝花'}],'Q':[{'id':'118221','uid':'qingdao','name':'青岛'},{'id':'118204','uid':'quanzhou','name':'泉州'},{'id':'118179','uid':'quzhou','name':'衢州'},{'id':'118349','uid':'qujing','name':'曲靖'},{'id':'118296','uid':'qingyuan','name':'清远'},{'id':'118346','uid':'qiandongnan','name':'黔东南'},{'id':'118347','uid':'qiannan','name':'黔南'},{'id':'118345','uid':'qianxinan','name':'黔西南'},{'id':'118090','uid':'qinhuangdao','name':'秦皇岛'},{'id':'118147','uid':'qiqihaer','name':'齐齐哈尔'},{'id':'118390','uid':'qingyang','name':'庆阳'},{'id':'118308','uid':'qinzhou','name':'钦州'},{'id':'128466','uid':'qianjiang','name':'潜江'},{'id':'118155','uid':'qitaihe','name':'七台河'},{'id':'131407','uid':'qionghai','name':'琼海'}],'R':[{'id':'118230','uid':'rizhao','name':'日照'}],'S':[{'id':'108296','uid':'shanghai','name':'上海'},{'id':'118282','uid':'shenzhen','name':'深圳'},{'id':'118163','uid':'suzhou','name':'苏州'},{'id':'118088','uid':'shijiazhuang','name':'石家庄'},{'id':'118123','uid':'shenyang','name':'沈阳'},{'id':'118219','uid':'shangrao','name':'上饶'},{'id':'118177','uid':'shaoxing','name':'绍兴'},{'id':'118250','uid':'shangqiu','name':'商丘'},{'id':'118284','uid':'shantou','name':'汕头'},{'id':'118171','uid':'suqian','name':'宿迁'},{'id':'118285','uid':'shaoguan','name':'韶关'},{'id':'118203','uid':'sanming','name':'三明'},{'id':'118271','uid':'shaoyang','name':'邵阳'},{'id':'118317','uid':'sanya','name':'三亚'},{'id':'118157','uid':'suihua','name':'绥化'},{'id':'118257','uid':'shiyan','name':'十堰'},{'id':'118293','uid':'shanwei','name':'汕尾'},{'id':'118139','uid':'siping','name':'四平'},{'id':'118325','uid':'suining','name':'遂宁'},{'id':'118194','uid':'118194','name':'宿州'},{'id':'118143','uid':'songyuan','name':'松原'},{'id':'118265','uid':'suizhou','name':'随州'},{'id':'118380','uid':'shangluo','name':'商洛'},{'id':'118404','uid':'shizuishan','name':'石嘴山'},{'id':'118248','uid':'sanmenxia','name':'三门峡'},{'id':'118105','uid':'shuozhou','name':'朔州'},{'id':'118150','uid':'shuangyashan','name':'双鸭山'},{'id':'128496','uid':'shihezi','name':'石河子'}],'T':[{'id':'108289','uid':'tianjin','name':'天津'},{'id':'118181','uid':'118181','name':'台州'},{'id':'118170','uid':'taizhou','name':'泰州'},{'id':'118089','uid':'tangshan','name':'唐山'},{'id':'118099','uid':'taiyuan','name':'太原'},{'id':'118229','uid':'taian','name':'泰安'},{'id':'118115','uid':'tongliao','name':'通辽'},{'id':'118134','uid':'tieling','name':'铁岭'},{'id':'118343','uid':'tongren','name':'铜仁'},{'id':'118141','uid':'tonghua','name':'通化'},{'id':'118384','uid':'tianshui','name':'天水'},{'id':'118189','uid':'tongling','name':'铜陵'},{'id':'118372','uid':'tongchuan','name':'铜川'},{'id':'118420','uid':'tacheng','name':'塔城'},{'id':'128464','uid':'tianmen','name':'天门'},{'id':'131579','uid':'131579','name':'屯昌'}],'W':[{'id':'118254','uid':'wuhan','name':'武汉'},{'id':'118174','uid':'wenzhou','name':'温州'},{'id':'118160','uid':'wuxi','name':'无锡'},{'id':'118225','uid':'weifang','name':'潍坊'},{'id':'118184','uid':'wuhu','name':'芜湖'},{'id':'118408','uid':'wulumuqi','name':'乌鲁木齐'},{'id':'118227','uid':'weihai','name':'威海'},{'id':'118375','uid':'weinan','name':'渭南'},{'id':'118305','uid':'wuzhou','name':'梧州'},{'id':'118119','uid':'wulanchabu','name':'乌兰察布'},{'id':'118113','uid':'wuhai','name':'乌海'},{'id':'118356','uid':'wenshan','name':'文山'},{'id':'118405','uid':'wuzhong','name':'吴忠'},{'id':'118386','uid':'wuwei','name':'武威'},{'id':'131497','uid':'wenchang','name':'文昌'},{'id':'131576','uid':'131576','name':'万宁'},{'id':'129309','uid':'129309','name':'吴江区'},{'id':'131575','uid':'131575','name':'五指山'}],'X':[{'id':'118371','uid':'xian','name':'西安'},{'id':'118201','uid':'xiamen','name':'厦门'},{'id':'118161','uid':'xuzhou','name':'徐州'},{'id':'118243','uid':'xinxiang','name':'新乡'},{'id':'118256','uid':'xiangyang','name':'襄阳'},{'id':'118251','uid':'xinyang','name':'信阳'},{'id':'118269','uid':'xiangtan','name':'湘潭'},{'id':'118092','uid':'xingtai','name':'邢台'},{'id':'118199','uid':'xuancheng','name':'宣城'},{'id':'118246','uid':'xuchang','name':'许昌'},{'id':'118264','uid':'xianning','name':'咸宁'},{'id':'118395','uid':'xining','name':'西宁'},{'id':'118262','uid':'xiaogan','name':'孝感'},{'id':'118374','uid':'xianyang','name':'咸阳'},{'id':'118280','uid':'xiangxi','name':'湘西'},{'id':'118213','uid':'xinyu','name':'新余'},{'id':'128465','uid':'xiantao','name':'仙桃'},{'id':'118108','uid':'xinzhou','name':'忻州'},{'id':'118122','uid':'xinganmeng','name':'兴安盟'},{'id':'118358','uid':'xishuangbanna','name':'西双版纳'},{'id':'118120','uid':'xilinguole','name':'锡林郭勒'},{'id':'118122','uid':'xinganmeng','name':'兴安盟'}],'Y':[{'id':'118167','uid':'yancheng','name':'盐城'},{'id':'118226','uid':'yantai','name':'烟台'},{'id':'118217','uid':'yichun','name':'宜春'},{'id':'118168','uid':'yangzhou','name':'扬州'},{'id':'118403','uid':'yinchuan','name':'银川'},{'id':'118107','uid':'yuncheng','name':'运城'},{'id':'118259','uid':'yichang','name':'宜昌'},{'id':'118295','uid':'yangjiang','name':'阳江'},{'id':'118329','uid':'yibin','name':'宜宾'},{'id':'118130','uid':'yingkou','name':'营口'},{'id':'118277','uid':'yongzhou','name':'永州'},{'id':'118310','uid':'yulin','name':'玉林'},{'id':'118145','uid':'yanbian','name':'延边'},{'id':'118275','uid':'yiyang','name':'益阳'},{'id':'118272','uid':'yueyang','name':'岳阳'},{'id':'118378','uid':'118378','name':'榆林'},{'id':'118350','uid':'yuxi','name':'玉溪'},{'id':'118376','uid':'yanan','name':'延安'},{'id':'118214','uid':'yingtan','name':'鹰潭'},{'id':'118419','uid':'yili','name':'伊犁'},{'id':'118102','uid':'yangquan','name':'阳泉'},{'id':'118301','uid':'yunfu','name':'云浮'},{'id':'118333','uid':'yaan','name':'雅安'},{'id':'118152','uid':'118152','name':'伊春'},{'id':'131061','uid':'131061','name':'杨凌区'}],'Z':[{'id':'118237','uid':'zhengzhou','name':'郑州'},{'id':'118298','uid':'zhongshan','name':'中山'},{'id':'118169','uid':'zhenjiang','name':'镇江'},{'id':'118283','uid':'zhuhai','name':'珠海'},{'id':'118268','uid':'zhuzhou','name':'株洲'},{'id':'118288','uid':'zhanjiang','name':'湛江'},{'id':'118205','uid':'zhangzhou','name':'漳州'},{'id':'118222','uid':'zibo','name':'淄博'},{'id':'118094','uid':'zhangjiakou','name':'张家口'},{'id':'118290','uid':'zhaoqing','name':'肇庆'},{'id':'118341','uid':'zunyi','name':'遵义'},{'id':'118252','uid':'zhoukou','name':'周口'},{'id':'118253','uid':'zhumadian','name':'驻马店'},{'id':'118223','uid':'zaozhuang','name':'枣庄'},{'id':'118180','uid':'zhoushan','name':'舟山'},{'id':'118319','uid':'zigong','name':'自贡'},{'id':'118335','uid':'ziyang','name':'资阳'},{'id':'118274','uid':'zhangjiajie','name':'张家界'},{'id':'118387','uid':'zhangye','name':'张掖'},{'id':'118407','uid':'zhongwei','name':'中卫'},{'id':'118352','uid':'zhaotong','name':'昭通'}]};
    var cityArr = cityJson[req.query.cityLetter];
    res.header("Content-Type", "application/json; charset=utf-8");
    for(var i=0;i<cityArr.length;i++){
        var cityObj = cityArr[i];
        var cityuid = cityArr[i].uid;
        var route = 'https://www.douban.com/location/'+cityuid+'/events/weekend-1803';
        superagent.get(route)
        .charset('utf-8')
        .end(function (err, sres) {
            if (err) {
                console.log('ERR: ' + err);
                res.json({code: failCode, msg: err});
                return;
            }
            var $ = cheerio.load(sres.text);

            var districtArr = [];
            $('.ui-fbox a').each(function (idx, element) {
                var $element = $(element);
                var href = $element.attr('href');
                var districtId = href.substring(href.lastIndexOf('-')+1);
                var districtName = $element.text();
                districtArr.push({
                    id: districtId,
                    name: districtName
                })
            });
            cityObj.district = districtArr;

            MongoClient.connect(DB_CONN_STR, function(err, db) {
                var collection = db.collection('city');

                //插入数据
                collection.insert(cityObj, function(error, result) { 
                    res.json({code: successCode, msg: "", data: result}); 
                    db.close();
                });
            });
            
        });
    }
});

app.get('/getopenid', function(req, res){
    var code = req.query.code;
    res.header("Content-Type", "application/json; charset=utf-8");

    superagent.get('https://api.weixin.qq.com/sns/jscode2session?appid=wx288b9aa48204f09c&secret=7f0d2d16a6d82ddb3fd3ade56bc23712&js_code='+code+'&grant_type=authorization_code')
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

app.get('/getaccesstoken', function(req, res){
    var code = req.query.code;
    res.header("Content-Type", "application/json; charset=utf-8");
       
    MongoClient.connect(DB_CONN_STR, function(err, db) {
        var collection = db.collection('wx');
        var requestNewToken = function(){
            superagent.get('https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=wx288b9aa48204f09c&secret=7f0d2d16a6d82ddb3fd3ade56bc23712')
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
app.get('/getqrcode', function(req, res){
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

app.get('/adduser', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");
    var userInfo = {
        openId: req.query.openId,
        nickName: req.query.nickName,
        gender: Number(req.query.gender),
        language: req.query.language,
        city: req.query.city,
        province: req.query.province,
        country: req.query.country,
        avatarUrl: req.query.avatarUrl
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
app.get('/finduser', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");
    var userId = req.query.id;
    MongoClient.connect(DB_CONN_STR, function(err, db) {
        console.log("finduser连接成功！");
        var collection = db.collection('user');
        collection.find({"_id":ObjectID(userId)}).toArray(function(err, items){        
            if(items.length>0) {
                res.json({code: successCode, msg: "", data: items[0]});
            } else {
                res.json({code: failCode, data: '用户不存在'}); 
            }
            db.close();
        });
    });
});
function computeAge(birthday) {
    var birthdayArr = birthday.split("-");  
    var birthYear = birthdayArr[0];  
    var birthMonth = birthdayArr[1];  
    var birthDay = birthdayArr[2]; 
    var d = new Date();  
    var nowYear = d.getFullYear();  
    var nowMonth = d.getMonth() + 1;  
    var nowDay = d.getDate();
    var ageDiff = nowYear - birthYear ; //年之差  

    if(nowMonth == birthMonth) {  
        var dayDiff = nowDay - birthDay;//日之差  
        if(dayDiff < 0) {  
            return ageDiff - 1;  
        }else {  
            return ageDiff ;  
        }  
    } else {  
        var monthDiff = nowMonth - birthMonth;//月之差  
        if(monthDiff < 0) {  
            return ageDiff - 1;  
        } else {  
            return ageDiff;  
        }  
    }
}
function getConstellation(birthday) {
    var birthdayArr = birthday.split("-"),
        birthMonthDay = birthdayArr[1] + '.' + birthdayArr[2],
        birthMonthDay = Number(birthMonthDay);

    if(birthMonthDay >= 3.21 && birthMonthDay <= 4.19) {
        return '白羊座';
    } else if(birthMonthDay >= 4.2 && birthMonthDay <= 5.2) {
        return '金牛座';
    } else if(birthMonthDay >= 5.21 && birthMonthDay <= 6.21) {
        return '双子座';
    } else if(birthMonthDay >= 6.22 && birthMonthDay <= 7.22) {
        return '巨蟹座';
    } else if(birthMonthDay >= 7.23 && birthMonthDay <= 8.22) {
        return '狮子座';
    } else if(birthMonthDay >= 8.23 && birthMonthDay <= 9.22) {
        return '处女座';
    } else if(birthMonthDay >= 9.23 && birthMonthDay <= 10.23) {
        return '天秤座';
    } else if(birthMonthDay >= 10.24 && birthMonthDay <= 11.22) {
        return '天蝎座';
    } else if(birthMonthDay >= 11.23 && birthMonthDay <= 12.21) {
        return '射手座';
    } else if((birthMonthDay >= 12.22 && birthMonthDay <= 12.31) || (birthMonthDay >= 1.1 && birthMonthDay <= 1.19)) {
        return '摩羯座';
    } else if(birthMonthDay >= 1.2 && birthMonthDay <= 2.18) {
        return '水瓶座';
    } else if(birthMonthDay >= 2.19 && birthMonthDay <= 3.2) {
        return '双鱼座';
    } 
}
app.post('/saveuserinfo', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");
    var userId = req.body.userId,
        birthday = req.body.birthday,
        updateInfo = {
            nickName: req.body.nickName,
            gender: Number(req.body.gender),
            birthday: birthday,
            age: computeAge(birthday),
            constellation: getConstellation(birthday),
            personality: req.body.personality,  
            business: req.body.business,  
            company: req.body.company,  
            profession: req.body.profession           
        };

    MongoClient.connect(DB_CONN_STR, function(err, db) {
        console.log("saveuserinfo连接成功！");
        var collection = db.collection('user');
        collection.update({'_id':ObjectID(userId)},{$set:updateInfo}, function(err, result) { 
            //如果存在错误
            if(err) {
                console.log('Error:'+ err);
                res.json({code: failCode, data: err}); 
                db.close();
                return;
            } 
            res.json({code: successCode, msg: "", data: updateInfo}); 
            db.close();
        });
    });
});
app.post('/upload', upload.single('file'), function (req, res, next) {
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
    var userId = req.body.userId,
        index = req.body.index;
    // 构建图片名
    var fileName = userId + '_' + Date.now() + lastName;

    co(function* () {
        var result = yield client.put(fileName, filePath);
            
        var updateInfo = {};
        updateInfo[index] = result.url.replace(/http:/,'https:');

        // 上传之后删除本地文件
        fs.unlinkSync(filePath);

        MongoClient.connect(DB_CONN_STR, function(err, db) {
            console.log("upload连接成功！");
            var collection = db.collection('user');
            collection.update({'_id':ObjectID(userId)},{$set:updateInfo}, function(err, result1) { 
                //如果存在错误
                if(err) {
                    res.json({code: failCode, data: err}); 
                    db.close();
                    return;
                } 
                res.send(result.url.replace(/http:/,'https:')); 
                db.close();
            });
        });
    }).catch(function (err) {
        console.log(err);
    }); 
})

app.post('/pubdate', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");
    var userId = req.body.userId;
    var dateInfo = {
        userId: userId,
        avatarUrl: req.body.avatarUrl,
        nickName: req.body.nickName,
        gender: Number(req.body.gender),
        age: Number(req.body.age),
        constellation: req.body.constellation,
        business: req.body.business,
        company: req.body.company,
        profession: req.body.profession,
        filmId: req.body.filmId+'',
        filmName: req.body.filmName,
        filmCover: req.body.filmCover,
        cityId: req.body.cityId+'',
        cityName: req.body.cityName,
        day: req.body.day,
        time: req.body.time,
        districtId: req.body.districtId+'',
        districtName: req.body.districtName,
        cinemaId: req.body.cinemaId+'',
        cinemaName: req.body.cinemaName,
        cinemaAddress: req.body.cinemaAddress,
        words: req.body.words,
        status: 1, // 0未匹配 1匹配中 2匹配成功
        createTime: Date.now()
    };
    MongoClient.connect(DB_CONN_STR, function(err, db) {
        console.log("db连接成功！");
        var collection = db.collection('dates');
        collection.insert(dateInfo, function(err, result) { 
            //如果存在错误
            if(err) {
                console.log('Error:'+ err);
                res.json({code: failCode, data: err}); 
                db.close();
                return;
            } 
            res.json({code: successCode, msg: "", data: result}); 

            collection.update({userId:userId,status:1,_id:{$ne:ObjectID(result.insertedIds[0])}},{$set:{status:0}}, function(err1, result1) { 
                db.close();
            });
        });
    });
});
app.get('/getdate', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");
    var userId = req.query.userId;

    MongoClient.connect(DB_CONN_STR, function(error, db) {
        console.log("getdate连接成功！");
        var collection = db.collection('dates');
        var collection_pair = db.collection('pair');
        collection.find({userId:userId, $or:[{status:1},{status:2}]}).sort({'createTime':-1}).limit(1).toArray(function(err, items){        
            if(items.length>0) {
                if(items[0].status===1){
                    res.json({code: successCode, msg: "", data: items[0]});
                    db.close();
                } else if(items[0].status===2) {
                    collection_pair.find({pair:{$in:[items[0]._id]}}).toArray(function(err1, arr){ 
                        res.json({code: 2, msg: "匹配成功", data: arr});
                        db.close();
                    });
                }
            } else {
                res.json({code: failCode, data: '没找到'}); 
                db.close();
            }
        });
    });
}); 

app.get('/match', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");
    var id = req.query.id,
        gender = req.query.gender,
        gender1 = gender==1?2:1,
        filmId = req.query.filmId+'',
        cityId = req.query.cityId+'',
        day = req.query.day,
        time = req.query.time,
        districtId = req.query.districtId+'',
        cinemaId = req.query.cinemaId+'';

    var matchInfo = {
        gender: gender1,
        filmId: filmId,
        cityId: cityId,
        day: day,
        time: time,
        status: 1
    };
    let orArr = [];
    if(districtId !== 'all') {
        orArr.push({districtId:'all'});
        orArr.push({districtId:districtId});
        matchInfo.$or = orArr;
    } 
    if(cinemaId !== '') {
        orArr.push({cinemaId:''});
        orArr.push({cinemaId:cinemaId});
        matchInfo.$or = orArr;
    }

    MongoClient.connect(DB_CONN_STR, function(err, db) {
        console.log("match连接成功！");
        var collection = db.collection('dates');
        collection.find({_id: ObjectID(id)}).toArray(function(err1, items1){ 
            if(items1[0].status===2) {
                var collection_pair = db.collection('pair');
                collection_pair.find({pair:{$in:[items1[0]._id]}}).toArray(function(err3, items3){ 
                    res.json({code: 2, msg: "匹配成功", data: items3});
                    db.close();
                });
            } else {
                collection.find(matchInfo).sort({'createTime':-1}).limit(100).toArray(function(err2, items2){ 
                    var filterArr = [];
                    if(items1[0].decidedIds && items1[0].decidedIds.length>0) { 
                        var decidedIds = items1[0].decidedIds.join(',');
                        for(var i=0,len=items2.length;i<len;i++) {
                            var dateId = items2[i]._id;
                            if(decidedIds.indexOf(dateId)<0) {
                                filterArr.push(items2[i]);
                            }
                        } 
                    } else {
                        filterArr = items2;
                    }     
                    if(filterArr.length>0) {
                        res.json({code: successCode, msg: "", data: filterArr});
                    } else {
                        res.json({code: failCode, data: '没匹配到'}); 
                    }
                    db.close();
                });
            }
        });
    });
});

app.get('/updatedate', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");
    var dateId = req.query.dateId,
        matchId = req.query.matchId,
        act = req.query.act;

    MongoClient.connect(DB_CONN_STR, function(err, db) {
        console.log("updatedate连接成功！");
        var collection = db.collection('dates');

        collection.find({_id: ObjectID(dateId)}).toArray(function(err1, items){ 
            var loveIdArr = items[0].loveIds || [],
                decidedIdArr = items[0].decidedIds || [];

            decidedIdArr.push(matchId);
            if(act==='yes') {
                loveIdArr.push(matchId);
                collection.find({_id: ObjectID(matchId),loveIds:{$in:[dateId]}}).toArray(function(err2, opposite){ 
                    if(opposite.length>0) {
                        console.log('匹配成功！！！');
                        var pairJson = {
                            status: 1,
                            pair: [
                                ObjectID(dateId),
                                ObjectID(matchId)
                            ],
                            userIds: [
                                ObjectID(items[0].userId),
                                ObjectID(opposite[0].userId)
                            ],
                            avatars: [
                                items[0].avatarUrl,
                                opposite[0].avatarUrl
                            ],
                            createTime: Date.now()
                        };
                        var collection_pair = db.collection('pair');
                        collection_pair.insert(pairJson, function(err23, result3) { 
                            collection.update({_id: ObjectID(dateId)},{$set:{loveIds:loveIdArr, decidedIds:decidedIdArr, status:2}}, function(err231, result231) {  
                                collection.update({_id: ObjectID(matchId)},{$set:{status:2}}, function(err232, result232) {                   
                                    res.json({code: 2, msg: "匹配成功", data: [pairJson]});
                                    db.close();
                                });
                            });
                        });
                            
                    } else {
                        collection.update({_id: ObjectID(dateId)},{$set:{loveIds:loveIdArr, decidedIds:decidedIdArr}}, function(err22, result2) {                     
                            res.json({code: successCode, msg: "", data: result2});
                            db.close();
                        });
                    }
                });
            } else {           
                collection.update({_id: ObjectID(dateId)},{$set:{decidedIds:decidedIdArr}}, function(err3, result) {                     
                    res.json({code: successCode, msg: "", data: result});
                    db.close();
                });
            }
        });     
    });
});

app.get('/getpair', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");
    var id = req.query.id;

    MongoClient.connect(DB_CONN_STR, function(error, db) {
        console.log("getpair连接成功！");
        var collection = db.collection('pair');
        var collection_dates = db.collection('dates');
        collection.find({_id: ObjectID(id)}).toArray(function(err, arr){ 
            console.log(arr.length);
            collection_dates.find({_id: {"$in": arr[0]["pair"]}}).toArray(function(err1, items){        
                res.json({code: successCode, msg: "", data: items, msgList: arr[0]['msgList']});
                db.close();
            });
        });       
        
    });
}); 

app.post('/sendmsg', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");
    var id = req.body.id;
    var msgObj = {
        userId: req.body.userId,
        words: req.body.words,
        sendTime: Date.now()
    };
    MongoClient.connect(DB_CONN_STR, function(err, db) {
        console.log("sendmsg连接成功！");
        var collection = db.collection('pair');
        collection.find({_id: ObjectID(id)}).toArray(function(err, arr){ 
            var msgList = arr[0].msgList || [];
            msgList.push(msgObj);
            collection.update({_id: ObjectID(id)},{$set:{msgList:msgList}}, function(err1, result1) { 
                res.json({code: successCode, msg: "", data: msgObj}); 
                db.close();
            });
        });
    });
});

app.get('/receivemsg', function(req, res){
    res.header("Content-Type", "application/json; charset=utf-8");
    var id = req.query.id;

    MongoClient.connect(DB_CONN_STR, function(error, db) {
        console.log("receivemsg连接成功！");
        var collection = db.collection('pair');
        collection.find({_id: ObjectID(id)},{msgList:1}).toArray(function(err, arr){ 
            res.json({code: successCode, msg: "", data: arr[0]['msgList']});
            db.close();
        });       
        
    });
}); 

app.post('/broadcast', function(req, res){
    var userId = req.body.userId,
        filmId = req.body.filmId+'';
    var dateInfo = {
        userId: userId,
        nickName: req.body.nickName,
        avatarUrl: req.body.avatarUrl,
        filmId: filmId,
        filmName: req.body.filmName,
        filmCover: req.body.filmCover,
        words: req.body.words,
        createTime: Date.now()
    };
    MongoClient.connect(DB_CONN_STR, function(err, db) {
        console.log("broadcast连接成功！");
        var collection = db.collection('broadcast');
        collection.find({userId:userId,filmId:filmId}).toArray(function(err1, items){ 
            if(items.length>0) {
                var broadcastId = items[0]._id;
                collection.update({_id: broadcastId},{$set:{words:req.body.words}}, function(err2, result1) { 
                    res.json({code: 1, msg: "", data: broadcastId}); 
                    db.close();
                });
            } else {
                collection.insert(dateInfo, function(err3, result2) { 
                    res.json({code: successCode, msg: "", data: result2.insertedIds[0]}); 
                    db.close();
                });
            }
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
