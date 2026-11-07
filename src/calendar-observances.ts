import { solarTermDays } from "./solar-term-data";

export type Ritual = "meal" | "light" | "craft" | "walk" | "gift" | "rest" | "thanks" | "remember" | "play";
export interface Observance {
  id: string; name: string; ritual: Ritual; prop: string; custom: string;
  kind: "传统节日" | "节气" | "现代节日" | "海外节日" | "纪念日";
  fixed?: string; lunar?: string; variable?: "easter" | "mother" | "father" | "thanksgiving";
  /** Modern national commemorations must never become historical characters' lived history. */
  modernOnly?: boolean;
}
const traditional = (id:string,name:string,lunar:string,ritual:Ritual,prop:string,custom:string):Observance => ({ id,name,lunar,ritual,prop,custom,kind:"传统节日" });
const fixed = (id:string,name:string,date:string,ritual:Ritual,prop:string,custom:string,kind:Observance["kind"]="现代节日",modernOnly=false):Observance => ({ id,name,fixed:date,ritual,prop,custom,kind,modernOnly });
const termNames = ["小寒","大寒","立春","雨水","惊蛰","春分","清明","谷雨","立夏","小满","芒种","夏至","小暑","大暑","立秋","处暑","白露","秋分","寒露","霜降","立冬","小雪","大雪","冬至"];
// Regional foods and seasonal scenes are choices, never rules imposed on every family.
const terms: Array<[Ritual,string,string]> = [
  ["rest","暖手的茶盏","小寒仍在隆冬。围炉、热饮可以是小小的暖意，不据节气推定当地已经下雪。"],
  ["meal","一碗热粥","大寒是二十四节气中的最后一个，可借整理年货、吃一顿热饭相伴，不等同于除夕。"],
  ["meal","一份春饼","部分地区立春有咬春、吃春饼或萝卜的习俗；吃什么由各自口味决定。"],
  ["rest","一把收拢的伞","雨水得名于物候变化，宜写檐雨、候春；不能保证用户所在地当天降雨。"],
  ["meal","一只洗净的梨","部分地区惊蛰有吃梨的习惯，只作应景饮食，不宣称医疗或驱邪功效。"],
  ["play","一枚画好记号的鸡蛋","春分可玩竖蛋，成功与否都是游戏；不能声称只有春分才立得住。"],
  ["remember","一束素净的花","清明有扫墓追思、踏青等习俗。尊重思念，不说清明快乐，不凭空认定用户亲人离世。"],
  ["rest","一盏春茶","谷雨前后常与赏春、茶事相连；不把谷雨茶的产地和功效一概而论。"],
  ["play","一枚装在网兜里的熟蛋","江南部分地区有立夏吃蛋、斗蛋习俗；熟蛋只作小游戏，不强迫饮食。"],
  ["rest","一杯温水","小满可以写将熟未熟的等待，不将所有地区都写成麦田丰收，不要求苦菜养生。"],
  ["walk","一枝平常的花","芒种时节的送花神等习俗具有地域性，这里借一枝花惜春迎夏，不把仪式写成普遍规则。"],
  ["meal","一碗清爽的面","部分地区有冬至饺子夏至面的说法；面只是一个选择，不代替用户决定口味。"],
  ["rest","一柄折扇","小暑可借摇扇、乘凉写日常。不据节气保证用户所在地高温或梅雨。"],
  ["rest","一碗温凉合宜的绿豆汤","大暑可写纳凉、消暑饮食。绿豆汤不是处方，不随意给冰饮或药膳建议。"],
  ["meal","一小碟切好的西瓜","部分地区立秋有啃秋、贴秋膘的说法；不催体重变化，也不把立秋当作全国立即降温。"],
  ["walk","一盏临水的灯","部分地区处暑前后有水灯等民俗；这里只借观灯寄愿，不鼓励向水域投放物品。"],
  ["rest","一盏温茶","白露的夜凉是季节意象，不是实况天气；也可只安静喝一盏茶。"],
  ["walk","一条秋日的散步路","秋分在北半球与昼夜大致等长相连，可写散步与收获，不把南北半球季节混用。"],
  ["rest","一盏菊花清茶","寒露可借赏菊、秋茶相伴；菊花茶仅作饮品，不作医疗建议。"],
  ["meal","一小块熟软的柿饼","部分地区霜降有吃柿子的习惯；不把地域习俗当强制，也不宣称御寒功效。"],
  ["meal","一碗热汤","立冬是冬季节气的起点，部分地区有饺子、补冬等习俗；热汤也可以，不强劝进补。"],
  ["meal","一小碟糍粑","部分地区小雪有做糍粑、腌菜等习俗；这里只借糍粑相伴，不说今天一定下雪。"],
  ["rest","一条干爽的围巾","大雪是节气名，不是天气预报。留一条围巾，也可以只在窗边坐一会儿。"],
  ["meal","一碗热腾腾的汤圆","冬至在北半球有白昼最短、长夜将尽的意味；北方饺子、部分南方地区汤圆等各有习惯，允许按口味选择。"]
];
export const observances: readonly Observance[] = [
  ...termNames.map((name,i):Observance => ({id:`term-${i}`,name,ritual:terms[i][0],prop:terms[i][1],custom:terms[i][2],kind:"节气"})),
  traditional("new-years-eve","除夕","除夕","light","一盏守岁的灯","除夕有团圆饭、守岁等习俗；不强迫熬夜，不预设用户一定能够回家。"),
  traditional("spring-festival","春节","正月-1","gift","一封写着平安的红笺","贴春联、拜年和压岁钱各有地域与年龄习惯；这里的红笺是故事道具，不是实际转账。"),
  traditional("lantern","元宵节","正月-15","light","一盏写着灯谜的小灯","元宵可赏灯、猜谜，汤圆与元宵的做法有区别，不能混作全国同一种。"),
  traditional("dragon-head","龙抬头","二月-2","rest","一把整理头发的木梳","农历二月初二，部分地区有理发等习惯；剪不剪头发由本人选择，不把吉祥话当因果。"),
  traditional("shangsi","上巳节","三月-3","walk","一条临水的春日小路","上巳有春游、临水等历史习俗，地域传承不同；不要求用户下水或参与祭祀。"),
  traditional("dragon-boat","端午节","五月-5","craft","一个艾草香囊","粽子、龙舟、佩香囊等各有地方习惯；不饮雄黄酒，不把香囊写成防病保证。"),
  traditional("qixi","七夕","七月-7","craft","一根尚未穿好的彩线","七夕有乞巧、穿针等习俗，也可借此表达心意；不拿传说强迫用户许下终身。"),
  traditional("ghost","中元节","七月-15","remember","一盏纸上画的小灯","中元在一些地区承载追思与祭祖。这里只用纸灯寄念，不恐吓用户，不宣称鬼神真实。"),
  traditional("mid-autumn","中秋节","八月-15","meal","一块分好的月饼","中秋常赏月、食月饼、寄团圆。不保证当晚有晴空，不把家人团聚当作人人都有的条件。"),
  traditional("double-ninth","重阳节","九月-9","walk","一条缓缓上行的山路","重阳常见登高、赏菊、敬老等习俗；不把同行的人自动写成长辈，不勉强登山饮酒。"),
  traditional("laba","腊八节","腊月-8","meal","一碗腊八粥","腊八粥各地配料不同，北方一些地区另有泡腊八蒜的习惯；先问忌口，不作功效保证。"),
  traditional("little-year-north","北方小年","腊月-23","craft","一张剪好的窗花","北方多在腊月二十三过小年，有扫尘、祭灶、吃糖瓜等习惯；不声称全国同日。"),
  traditional("little-year-south","南方小年","腊月-24","craft","一张红色窗花","南方不少地区在腊月二十四过小年，也有别日习惯；按用户所在地和家中习惯选择。"),
  fixed("new-year","元旦","01-01","light","一盏照着新日历的小灯","公历新年可倒数、互道祝愿；不用午夜在线证明感情。"),
  fixed("valentine","情人节","02-14","gift","一封没有署名的短笺","一些地区会在二月十四日赠花、巧克力或卡片；不预设双方已是恋人，不强求回礼。","海外节日"),
  fixed("women","国际妇女节","03-08","thanks","一张认真写给你的卡片","尊重女性的权利、劳动和选择，不把节日缩成外貌夸奖或购物，也不替用户认定性别。"),
  fixed("april-fools","愚人节","04-01","play","一张能翻开的小纸牌","一些地方有轻松玩笑的习惯；不用分手、受伤、失联或疾病开玩笑，不制造惊吓。","海外节日"),
  fixed("labour","劳动节","05-01","rest","一张留白的日程纸","向劳动致意，也给休息留下空间；不假定人人放假，历史角色不预知后来的放假制度。","现代节日",true),
  fixed("love-520","520","05-20","gift","一张写着今天日期的小卡","现代中文谐音表达的日子，并非传统节日；历史人物只回应你解释后的心意。","纪念日",true),
  fixed("children","儿童节","06-01","play","一只简单的纸风车","可以照顾成年人的童心，不将恋爱对象写成儿童，不把成年人称作受监护的小孩。","现代节日",true),
  fixed("rice-817","八一七相逢纪念","08-17","light","一盏留给归人的灯","作品社群的相逢纪念，不是张起灵确切生日；历史人物不预知后代或青铜门未来事件。","纪念日",true),
  fixed("teachers","教师节","09-10","thanks","一张记着感谢的小笺","中国现行教师节日期用于日历纪念；不将角色与用户强行套进师生关系。","现代节日",true),
  fixed("national","国庆节","10-01","rest","一张空出的同行计划","现代中国的节日；历史角色只回应用户说起的休息与见面，不预知建国、阅兵或黄金周。","现代节日",true),
  fixed("halloween","万圣夜","10-31","play","一只装着糖的小纸袋","十月三十一日晚常见装扮、南瓜灯与讨糖游戏，与十一月一日的诸圣节有别；不以恐怖桥段试探恐惧。","海外节日"),
  fixed("christmas-eve","平安夜","12-24","light","一盏陪着平安卡的小灯","圣诞前夕可交换祝福。中国送苹果是本土谐音习惯，不声称全世界都有；不强加宗教信仰。","海外节日"),
  fixed("christmas","圣诞节","12-25","gift","一份用纸包好的小礼物","圣诞树、赠礼与团聚的习惯因地区、宗教和家庭而异；不让任何角色自动拥有西方成长史。","海外节日"),
  fixed("year-end","跨年夜","12-31","light","一盏留到新岁的小灯","公历岁末可倒数，也可以早点休息；不要求守到零点，不将一次相伴写成终身承诺。","纪念日"),
  {id:"easter",name:"复活节",variable:"easter",ritual:"craft",prop:"一枚画着花纹的彩蛋",custom:"采用西方教会公历复活节日期。彩蛋、寻蛋是部分地方的活动，不等于所有宗派同日，也不让角色因此信教。",kind:"海外节日"},
  {id:"mother",name:"母亲节",variable:"mother",ritual:"thanks",prop:"一张可以自行落款的感谢卡",custom:"采用许多地区通行的五月第二个星期日。不假设家庭圆满，也不将用户或女性角色称作母亲。",kind:"海外节日"},
  {id:"father",name:"父亲节",variable:"father",ritual:"thanks",prop:"一张尚未寄出的卡片",custom:"采用许多地区通行的六月第三个星期日。可以感谢愿意感谢的人，也可以不参与，不预设父子关系。",kind:"海外节日"},
  {id:"thanksgiving",name:"感恩节（美国）",variable:"thanksgiving",ritual:"thanks",prop:"一张写着具体谢意的小笺",custom:"这里只采用美国十一月第四个星期四的日期；加拿大日期不同，不把它称作全球统一节日，也不把殖民历史写成童话。",kind:"海外节日"}
];

const lunarFormat = new Intl.DateTimeFormat("zh-CN-u-ca-chinese",{month:"long",day:"numeric",timeZone:"Asia/Shanghai"});
const partsFor = (key:string) => lunarFormat.formatToParts(new Date(`${key}T12:00:00+08:00`));
function easter(year:number):string {
  const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3);
  const h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451);
  const n=h+l-7*m+114;
  return `${year}-${String(Math.floor(n/31)).padStart(2,"0")}-${String(n%31+1).padStart(2,"0")}`;
}
export function observancesOnDay(key:string):Observance[] {
  if(!/^(19|20|21)\d{2}-\d{2}-\d{2}$/.test(key))return [];
  const date=new Date(`${key}T12:00:00+08:00`);
  if(!Number.isFinite(+date)||date.toISOString().slice(0,10)!==key)return [];
  const year=Number(key.slice(0,4)),month=Number(key.slice(5,7)),day=Number(key.slice(8));
  const parts=partsFor(key),lm=parts.find(p=>p.type==="month")?.value,ld=Number(parts.find(p=>p.type==="day")?.value);
  const next=partsFor(new Date(+date+86400000).toISOString().slice(0,10));
  const lunarKey=lm==="腊月"&&next.some(p=>p.type==="day"&&Number(p.value)===1)?"除夕":`${lm}-${ld}`;
  const weekday=new Date(Date.UTC(year,month-1,day)).getUTCDay(),week=Math.ceil(day/7);
  return observances.filter(event=>{
    if(event.id.startsWith("term-")){const index=Number(event.id.slice(5));return month===Math.floor(index/2)+1&&solarTermDays[String(year)]?.[index]===day;}
    if(event.fixed)return event.fixed===key.slice(5);
    if(event.lunar)return event.lunar===lunarKey;
    switch(event.variable){case "easter":return easter(year)===key;case "mother":return month===5&&weekday===0&&week===2;case "father":return month===6&&weekday===0&&week===3;case "thanksgiving":return month===11&&weekday===4&&week===4;default:return false;}
  });
}
