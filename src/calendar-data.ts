import type { BirthdayDate } from "./types";
import type { HolidayYear } from "./calendar";

/** Sources checked 2026-11-03. Unknown dates are intentionally not invented. */
export interface BirthdaySource { date?: BirthdayDate; month?: number; status: string; source: string; url: string; note: string }
export const birthdaySources: Record<string, BirthdaySource> = {
  "wu-xie": {
    "date": {
      "month": 3,
      "day": 5
    },
    "status": "官方庆生日",
    "source": "盗墓笔记DMBJ · 吴邪庆生公告",
    "url": "https://www.sina.cn/news/detail/5139093945847020.html",
    "note": "采用官方账号公开庆生日期；不代表原著已公布出生年份。"
  },
  "wang-pangzi": {
    "date": {
      "month": 4,
      "day": 18
    },
    "status": "官方庆生日",
    "source": "八一七稻米节 · 王胖子生日活动",
    "url": "https://www.sina.cn/news/detail/5153856153979625.html",
    "note": "采用官方账号公开庆生日期；不代表原著已公布出生年份。"
  },
  "xie-yuchen": {
    "date": {
      "month": 10,
      "day": 3
    },
    "status": "官方庆生日",
    "source": "盗墓笔记IP管理会 · 解雨臣生日专题",
    "url": "https://www.sina.cn/news/detail/5343118471991854.html",
    "note": "采用官方账号公开庆生日期；不代表原著已公布出生年份。"
  },
  "hei-xiazi": {
    "date": {
      "month": 1,
      "day": 23
    },
    "status": "官方庆生日",
    "source": "八一七稻米节 · 黑瞎子生日活动",
    "url": "https://www.sina.cn/news/detail/5256483542402883.html",
    "note": "采用官方账号公开庆生日期；不代表原著已公布出生年份。"
  },
  "huo-xiuxiu": {
    "date": {
      "month": 5,
      "day": 3
    },
    "status": "官方庆生日",
    "source": "八一七稻米节 · 霍秀秀生日祝福",
    "url": "https://www.sina.cn/news/detail/5294519172990306.html",
    "note": "采用官方账号公开庆生日期；不代表原著已公布出生年份。"
  },
  "zhang-qiling": {
    "month": 11,
    "status": "生日季",
    "source": "八一七稻米节 · 张起灵生日季",
    "url": "https://www.sina.cn/news/detail/5103490060517442.html",
    "note": "十一月生日季，具体出生日期未明确。活动发帖日不当作生日；可自行设定日期。"
  },
  "liu-sang": {
    "status": "待确认",
    "source": "联网检索线索（非官方生日依据）",
    "url": "https://www.so.com/s?q=%E5%88%98%E4%B8%A7%20%E7%94%9F%E6%97%A5%20%E5%AE%98%E6%96%B9%20%E7%9B%97%E5%A2%93%E7%AC%94%E8%AE%B0",
    "note": "搜索到 4 月 15 日的粉丝庆生，未核到官方日期。"
  },
  "a-ning": {
    "status": "待确认",
    "source": "联网检索线索（非官方生日依据）",
    "url": "https://www.so.com/s?q=%E9%98%BF%E5%AE%81%20%E7%94%9F%E6%97%A5%20%E5%AE%98%E6%96%B9%20%E7%9B%97%E5%A2%93%E7%AC%94%E8%AE%B0",
    "note": "搜索到 12 月 23 日的粉丝庆生，未核到官方日期。"
  },
  "zhang-haike": {
    "status": "待确认",
    "source": "联网检索线索（非官方生日依据）",
    "url": "https://www.so.com/s?q=%E5%BC%A0%E6%B5%B7%E5%AE%A2%20%E7%94%9F%E6%97%A5%20%E5%AE%98%E6%96%B9%20%E7%9B%97%E5%A2%93%E7%AC%94%E8%AE%B0",
    "note": "搜索到 10 月 26 日的粉丝庆生，未核到官方日期。"
  },
  "zhang-haiyan": {
    "status": "待确认",
    "source": "联网检索线索（非官方生日依据）",
    "url": "https://www.so.com/s?q=%E5%BC%A0%E6%B5%B7%E7%9B%90%20%E7%94%9F%E6%97%A5%20%E5%AE%98%E6%96%B9%20%E7%9B%97%E5%A2%93%E7%AC%94%E8%AE%B0",
    "note": "本次未检索到可靠的官方月日，保留为空，可自行补充。"
  },
  "zhang-haixia": {
    "status": "待确认",
    "source": "联网检索线索（非官方生日依据）",
    "url": "https://www.so.com/s?q=%E5%BC%A0%E6%B5%B7%E8%99%BE%20%E7%94%9F%E6%97%A5%20%E5%AE%98%E6%96%B9%20%E7%9B%97%E5%A2%93%E7%AC%94%E8%AE%B0",
    "note": "本次未检索到可靠的官方月日，保留为空，可自行补充。"
  },
  "zhang-haiqi": {
    "status": "待确认",
    "source": "联网检索线索（非官方生日依据）",
    "url": "https://www.so.com/s?q=%E5%BC%A0%E6%B5%B7%E7%90%AA%20%E7%94%9F%E6%97%A5%20%E5%AE%98%E6%96%B9%20%E7%9B%97%E5%A2%93%E7%AC%94%E8%AE%B0",
    "note": "本次未检索到可靠的官方月日，保留为空，可自行补充。"
  },
  "wang-can": {
    "status": "待确认",
    "source": "联网检索线索（非官方生日依据）",
    "url": "https://www.so.com/s?q=%E6%B1%AA%E7%81%BF%20%E7%94%9F%E6%97%A5%20%E5%AE%98%E6%96%B9%20%E7%9B%97%E5%A2%93%E7%AC%94%E8%AE%B0",
    "note": "搜索到 11 月 3 日的粉丝庆生，未核到官方日期；不采用演员生日。"
  },
  "li-cu": {
    "status": "待确认",
    "source": "联网检索线索（非官方生日依据）",
    "url": "https://www.so.com/s?q=%E9%BB%8E%E7%B0%87%20%E7%94%9F%E6%97%A5%20%E5%AE%98%E6%96%B9%20%E7%9B%97%E5%A2%93%E7%AC%94%E8%AE%B0",
    "note": "搜索到 1 月 19 日的粉丝庆生，未核到官方日期。"
  },
  "su-wan": {
    "status": "待确认",
    "source": "联网检索线索（非官方生日依据）",
    "url": "https://www.so.com/s?q=%E8%8B%8F%E4%B8%87%20%E7%94%9F%E6%97%A5%20%E5%AE%98%E6%96%B9%20%E7%9B%97%E5%A2%93%E7%AC%94%E8%AE%B0",
    "note": "本次未检索到可靠的官方月日，保留为空，可自行补充。"
  },
  "yang-hao": {
    "status": "待确认",
    "source": "联网检索线索（非官方生日依据）",
    "url": "https://www.so.com/s?q=%E6%9D%A8%E5%A5%BD%20%E7%94%9F%E6%97%A5%20%E5%AE%98%E6%96%B9%20%E7%9B%97%E5%A2%93%E7%AC%94%E8%AE%B0",
    "note": "本次未检索到可靠的官方月日，保留为空，可自行补充。"
  }
};

/** Official notices are included so holidays work offline. */
export const builtInHolidays: Record<string, HolidayYear> = {
  "2025": {
    "year": 2025,
    "papers": [
      "https://www.gov.cn/zhengce/zhengceku/202411/content_6986383.htm"
    ],
    "days": [
      {
        "name": "元旦",
        "date": "2025-01-01",
        "isOffDay": true
      },
      {
        "name": "春节",
        "date": "2025-01-26",
        "isOffDay": false
      },
      {
        "name": "春节",
        "date": "2025-01-28",
        "isOffDay": true
      },
      {
        "name": "春节",
        "date": "2025-01-29",
        "isOffDay": true
      },
      {
        "name": "春节",
        "date": "2025-01-30",
        "isOffDay": true
      },
      {
        "name": "春节",
        "date": "2025-01-31",
        "isOffDay": true
      },
      {
        "name": "春节",
        "date": "2025-02-01",
        "isOffDay": true
      },
      {
        "name": "春节",
        "date": "2025-02-02",
        "isOffDay": true
      },
      {
        "name": "春节",
        "date": "2025-02-03",
        "isOffDay": true
      },
      {
        "name": "春节",
        "date": "2025-02-04",
        "isOffDay": true
      },
      {
        "name": "春节",
        "date": "2025-02-08",
        "isOffDay": false
      },
      {
        "name": "清明节",
        "date": "2025-04-04",
        "isOffDay": true
      },
      {
        "name": "清明节",
        "date": "2025-04-05",
        "isOffDay": true
      },
      {
        "name": "清明节",
        "date": "2025-04-06",
        "isOffDay": true
      },
      {
        "name": "劳动节",
        "date": "2025-04-27",
        "isOffDay": false
      },
      {
        "name": "劳动节",
        "date": "2025-05-01",
        "isOffDay": true
      },
      {
        "name": "劳动节",
        "date": "2025-05-02",
        "isOffDay": true
      },
      {
        "name": "劳动节",
        "date": "2025-05-03",
        "isOffDay": true
      },
      {
        "name": "劳动节",
        "date": "2025-05-04",
        "isOffDay": true
      },
      {
        "name": "劳动节",
        "date": "2025-05-05",
        "isOffDay": true
      },
      {
        "name": "端午节",
        "date": "2025-05-31",
        "isOffDay": true
      },
      {
        "name": "端午节",
        "date": "2025-06-01",
        "isOffDay": true
      },
      {
        "name": "端午节",
        "date": "2025-06-02",
        "isOffDay": true
      },
      {
        "name": "国庆节、中秋节",
        "date": "2025-09-28",
        "isOffDay": false
      },
      {
        "name": "国庆节、中秋节",
        "date": "2025-10-01",
        "isOffDay": true
      },
      {
        "name": "国庆节、中秋节",
        "date": "2025-10-02",
        "isOffDay": true
      },
      {
        "name": "国庆节、中秋节",
        "date": "2025-10-03",
        "isOffDay": true
      },
      {
        "name": "国庆节、中秋节",
        "date": "2025-10-04",
        "isOffDay": true
      },
      {
        "name": "国庆节、中秋节",
        "date": "2025-10-05",
        "isOffDay": true
      },
      {
        "name": "国庆节、中秋节",
        "date": "2025-10-06",
        "isOffDay": true
      },
      {
        "name": "国庆节、中秋节",
        "date": "2025-10-07",
        "isOffDay": true
      },
      {
        "name": "国庆节、中秋节",
        "date": "2025-10-08",
        "isOffDay": true
      },
      {
        "name": "国庆节、中秋节",
        "date": "2025-10-11",
        "isOffDay": false
      }
    ]
  },
  "2026": {
    "year": 2026,
    "papers": [
      "https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm"
    ],
    "days": [
      {
        "name": "元旦",
        "date": "2026-01-01",
        "isOffDay": true
      },
      {
        "name": "元旦",
        "date": "2026-01-02",
        "isOffDay": true
      },
      {
        "name": "元旦",
        "date": "2026-01-03",
        "isOffDay": true
      },
      {
        "name": "元旦",
        "date": "2026-01-04",
        "isOffDay": false
      },
      {
        "name": "春节",
        "date": "2026-02-14",
        "isOffDay": false
      },
      {
        "name": "春节",
        "date": "2026-02-15",
        "isOffDay": true
      },
      {
        "name": "春节",
        "date": "2026-02-16",
        "isOffDay": true
      },
      {
        "name": "春节",
        "date": "2026-02-17",
        "isOffDay": true
      },
      {
        "name": "春节",
        "date": "2026-02-18",
        "isOffDay": true
      },
      {
        "name": "春节",
        "date": "2026-02-19",
        "isOffDay": true
      },
      {
        "name": "春节",
        "date": "2026-02-20",
        "isOffDay": true
      },
      {
        "name": "春节",
        "date": "2026-02-21",
        "isOffDay": true
      },
      {
        "name": "春节",
        "date": "2026-02-22",
        "isOffDay": true
      },
      {
        "name": "春节",
        "date": "2026-02-23",
        "isOffDay": true
      },
      {
        "name": "春节",
        "date": "2026-02-28",
        "isOffDay": false
      },
      {
        "name": "清明节",
        "date": "2026-04-04",
        "isOffDay": true
      },
      {
        "name": "清明节",
        "date": "2026-04-05",
        "isOffDay": true
      },
      {
        "name": "清明节",
        "date": "2026-04-06",
        "isOffDay": true
      },
      {
        "name": "劳动节",
        "date": "2026-05-01",
        "isOffDay": true
      },
      {
        "name": "劳动节",
        "date": "2026-05-02",
        "isOffDay": true
      },
      {
        "name": "劳动节",
        "date": "2026-05-03",
        "isOffDay": true
      },
      {
        "name": "劳动节",
        "date": "2026-05-04",
        "isOffDay": true
      },
      {
        "name": "劳动节",
        "date": "2026-05-05",
        "isOffDay": true
      },
      {
        "name": "劳动节",
        "date": "2026-05-09",
        "isOffDay": false
      },
      {
        "name": "端午节",
        "date": "2026-06-19",
        "isOffDay": true
      },
      {
        "name": "端午节",
        "date": "2026-06-20",
        "isOffDay": true
      },
      {
        "name": "端午节",
        "date": "2026-06-21",
        "isOffDay": true
      },
      {
        "name": "国庆节",
        "date": "2026-09-20",
        "isOffDay": false
      },
      {
        "name": "中秋节",
        "date": "2026-09-25",
        "isOffDay": true
      },
      {
        "name": "中秋节",
        "date": "2026-09-26",
        "isOffDay": true
      },
      {
        "name": "中秋节",
        "date": "2026-09-27",
        "isOffDay": true
      },
      {
        "name": "国庆节",
        "date": "2026-10-01",
        "isOffDay": true
      },
      {
        "name": "国庆节",
        "date": "2026-10-02",
        "isOffDay": true
      },
      {
        "name": "国庆节",
        "date": "2026-10-03",
        "isOffDay": true
      },
      {
        "name": "国庆节",
        "date": "2026-10-04",
        "isOffDay": true
      },
      {
        "name": "国庆节",
        "date": "2026-10-05",
        "isOffDay": true
      },
      {
        "name": "国庆节",
        "date": "2026-10-06",
        "isOffDay": true
      },
      {
        "name": "国庆节",
        "date": "2026-10-07",
        "isOffDay": true
      },
      {
        "name": "国庆节",
        "date": "2026-10-10",
        "isOffDay": false
      }
    ]
  }
};
