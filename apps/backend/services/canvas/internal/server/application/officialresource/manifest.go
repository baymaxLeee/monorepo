package officialresource

import (
	domainasset "github.com/example/monorepo/canvas/internal/server/domain/asset"
	domainresource "github.com/example/monorepo/canvas/internal/server/domain/resource"
)

// staticManifest 是按代码内常量声明的官方清单。
type staticManifest struct {
	entries []ManifestEntry
}

// NewStaticManifest 返回官方预置素材清单。
func NewStaticManifest() Manifest {
	return staticManifest{entries: officialManifestEntries()}
}

func (m staticManifest) Entries() []ManifestEntry {
	return append([]ManifestEntry(nil), m.entries...)
}

// officialManifestEntries 声明官方预置音色，共 185 条。
//
// 来源是 magico 侧的音色清单（`src/features/tts/speakerCatalog.ts`）经其去重规则收敛后的
// 结果：205 条原始条目剔除 10 条失效项与 10 条重名项。失效项按产品口径直接删除；重名项
// 保留后出现者，因为同名条目会撞官方名称唯一索引。
//
// slug 取 magico 侧的 Coze 音色 id：它在清单内唯一且稳定，与名称、内容都解耦，因此改名与
// 换内容都不会被对账误判成「旧条目下线 + 新条目上线」。
//
// 音频产物已交付，作为普通文件随仓库提交并打进镜像（runtime/preset-voices/{slug}.mp3）。
// 每条的 FileName 由音色名推导为「音色名.mp3」——这批文件名去后缀恰好等于音色名。上传链路
// 按 slug 从该目录读文件走 UploadBlob + LongLiveArtifact 注册内部 Asset，再由对账物化出
// 官方 Resource。
func officialManifestEntries() []ManifestEntry {
	return []ManifestEntry{
		voiceEntry("7620288417930297386", "邻家女孩 2.0"),
		voiceEntry("7566481398970712100", "vivi"),
		voiceEntry("7568423452617506870", "大壹"),
		voiceEntry("7568423452617523254", "黑猫侦探社咪仔"),
		voiceEntry("7568423452617539638", "鸡汤女"),
		voiceEntry("7568423452617572406", "流畅女声"),
		voiceEntry("7568423452617588790", "儒雅逸辰"),
		voiceEntry("7620302716920971318", "温柔女神"),
		voiceEntry("7426720361732980745", "少年梓辛"),
		voiceEntry("7426720361733144585", "邻家女孩"),
		voiceEntry("7426720361733177353", "渊博小叔"),
		voiceEntry("7426720361753903141", "爽快思思"),
		voiceEntry("7426720361753952293", "温暖阿虎"),
		voiceEntry("7426725529589596187", "甜美小源"),
		voiceEntry("7426725529589612571", "清澈梓梓"),
		voiceEntry("7426725529589645339", "解说小明"),
		voiceEntry("7426725529589661723", "开朗姐姐"),
		voiceEntry("7426725529589678107", "邻家男孩"),
		voiceEntry("7426725529589694491", "甜美悦悦"),
		voiceEntry("7426725529681657907", "心灵鸡汤"),
		voiceEntry("7468512265134899251", "知性女声"),
		voiceEntry("7468512265134915635", "清新女声"),
		voiceEntry("7468512265134981171", "邻家小妹"),
		voiceEntry("7468512265151610907", "清爽男大"),
		voiceEntry("7468512265151627291", "贴心女声"),
		voiceEntry("7468518753626521637", "知性温婉"),
		voiceEntry("7468518753626587173", "暖心体贴"),
		voiceEntry("7468518753626619941", "温柔文雅"),
		voiceEntry("7468518753626652709", "开朗轻快"),
		voiceEntry("7468518753626701861", "活泼爽朗"),
		voiceEntry("7468518846874288179", "率真小伙"),
		voiceEntry("7481299960424562742", "灿灿 2.0"),
		voiceEntry("7481299960424579126", "炀炀"),
		voiceEntry("7481299960424595510", "灿灿"),
		voiceEntry("7481299960424611894", "通用女声"),
		voiceEntry("7481299960424628278", "通用男声"),
		voiceEntry("7481299960424775734", "亲切女声"),
		voiceEntry("7502012172269240359", "懒音绵宝"),
		voiceEntry("7534613951015845929", "暖阳女声"),
		voiceEntry("7539812934491619367", "灵动欣欣"),
		voiceEntry("7539813339484913700", "阳光洋洋"),
		voiceEntry("7539813339484946468", "秀丽倩倩"),
		voiceEntry("7568478038065709075", "Tina老师"),
		voiceEntry("7559804070903611431", "元气甜妹"),
		voiceEntry("7619304808578809919", "撒娇学妹 2.0"),
		voiceEntry("7568423452617637942", "爽朗少年"),
		voiceEntry("7568423452617654326", "天才同桌"),
		voiceEntry("7568423452617670710", "知性灿灿"),
		voiceEntry("7426720361733013513", "魅力女友"),
		voiceEntry("7426720361733029897", "深夜播客"),
		voiceEntry("7426720361733046281", "柔美女友"),
		voiceEntry("7426720361733062665", "撒娇学妹"),
		voiceEntry("7426720361733160969", "高冷御姐"),
		voiceEntry("7426720361733210121", "傲娇霸总"),
		voiceEntry("7426725529589514267", "病弱少女"),
		voiceEntry("7426725529589530651", "活泼女孩"),
		voiceEntry("7426725529589547035", "和蔼奶奶"),
		voiceEntry("7426725529589563419", "邻居阿姨"),
		voiceEntry("7426725529589579803", "温柔小雅"),
		voiceEntry("7426725529589628955", "东方浩然"),
		voiceEntry("7468512265134817331", "天才童声"),
		voiceEntry("7468512265134850099", "猴哥"),
		voiceEntry("7468512265134866483", "熊二"),
		voiceEntry("7468512265134882867", "佩奇猪"),
		voiceEntry("7468512265134948403", "婆婆"),
		voiceEntry("7468512265134964787", "武则天"),
		voiceEntry("7468512265151463451", "少儿故事"),
		voiceEntry("7468512265151479835", "四郎"),
		voiceEntry("7468512265151496219", "顾姐"),
		voiceEntry("7468512265151512603", "樱桃丸子"),
		voiceEntry("7468512265151660059", "俏皮女声"),
		voiceEntry("7468512265151676443", "萌丫头"),
		voiceEntry("7468518753626538021", "绿茶小哥"),
		voiceEntry("7468518753626554405", "娇弱萝莉"),
		voiceEntry("7468518753626570789", "冷淡疏离"),
		voiceEntry("7468518753626603557", "憨厚敦实"),
		voiceEntry("7468518753626636325", "傲气凌人"),
		voiceEntry("7468518753626669093", "活泼刁蛮"),
		voiceEntry("7468518753626685477", "固执病娇"),
		voiceEntry("7468518753626718245", "撒娇粘人"),
		voiceEntry("7468518753626734629", "傲慢娇声"),
		voiceEntry("7468518753626751013", "潇洒随性"),
		voiceEntry("7468518753626767397", "腹黑公子"),
		voiceEntry("7468518753626783781", "诡异神秘"),
		voiceEntry("7468518753626800165", "儒雅才俊"),
		voiceEntry("7468518846874255411", "病娇白莲"),
		voiceEntry("7468518846874271795", "正直青年"),
		voiceEntry("7468518846874304563", "娇憨女王"),
		voiceEntry("7468518846874320947", "病娇萌妹"),
		voiceEntry("7468518846874337331", "青涩小生"),
		voiceEntry("7468518846874353715", "纯真学弟"),
		voiceEntry("7468518846874370099", "暖心学姐"),
		voiceEntry("7468518846874386483", "可爱女生"),
		voiceEntry("7468518846874402867", "成熟姐姐"),
		voiceEntry("7468518846874419251", "病娇姐姐"),
		voiceEntry("7468518846874435635", "优柔帮主"),
		voiceEntry("7468518846874452019", "优柔公子"),
		voiceEntry("7468518846874468403", "妩媚御姐"),
		voiceEntry("7468518846874484787", "调皮公主"),
		voiceEntry("7468518846874501171", "傲娇女友"),
		voiceEntry("7468518846874517555", "贴心男友"),
		voiceEntry("7468518846874533939", "少年将军"),
		voiceEntry("7468518846874550323", "贴心女友"),
		voiceEntry("7468518846874566707", "病娇哥哥"),
		voiceEntry("7468518920446541862", "学霸男同桌"),
		voiceEntry("7468518920446558246", "幽默叔叔"),
		voiceEntry("7468518920446574630", "性感御姐"),
		voiceEntry("7468518920446591014", "假小子"),
		voiceEntry("7468518920446607398", "冷峻上司"),
		voiceEntry("7468518920446623782", "温柔男同桌"),
		voiceEntry("7468518920446640166", "病娇弟弟"),
		voiceEntry("7468518920446656550", "幽默大爷"),
		voiceEntry("7468518920446672934", "傲慢少爷"),
		voiceEntry("7468518920446689318", "神秘法师"),
		voiceEntry("7481299960424857654", "奶气萌娃"),
		voiceEntry("7481299960424874038", "磁性男声"),
		voiceEntry("7481299960428757031", "知性姐姐-双语"),
		voiceEntry("7481299960428773415", "温柔小哥"),
		voiceEntry("7468512265134932019", "悬疑解说"),
		voiceEntry("7468512265151528987", "磁性解说男声"),
		voiceEntry("7468512265151561755", "鸡汤妹妹"),
		voiceEntry("7468512265151594523", "广告解说"),
		voiceEntry("7481299960424792118", "说唱小哥"),
		voiceEntry("7481299960424808502", "影视解说小美"),
		voiceEntry("7481299960424824886", "阳光男声"),
		voiceEntry("7481299960424841270", "活泼女声"),
		voiceEntry("7468512265151758363", "活力小哥"),
		voiceEntry("7468518753626505253", "温柔淑女"),
		voiceEntry("7481299960424644662", "擎苍"),
		voiceEntry("7481299960424661046", "阳光青年"),
		voiceEntry("7481299960424677430", "通用赘婿"),
		voiceEntry("7481299960424693814", "古风少御"),
		voiceEntry("7481299960424710198", "霸气青叔"),
		voiceEntry("7481299960424726582", "开朗青年"),
		voiceEntry("7481299960424742966", "甜宠少御"),
		voiceEntry("7481299960424759350", "儒雅青年"),
		voiceEntry("7426720361732915209", "湾区大叔"),
		voiceEntry("7426720361732931593", "呆萌川妹"),
		voiceEntry("7426720361732947977", "广州德哥"),
		voiceEntry("7426720361732964361", "北京小爷"),
		voiceEntry("7426720361733079049", "浩宇小哥"),
		voiceEntry("7426720361733095433", "广西远舟"),
		voiceEntry("7426720361733111817", "妹坨洁儿"),
		voiceEntry("7426720361733128201", "豫州子轩"),
		voiceEntry("7426720361753870373", "京腔侃爷"),
		voiceEntry("7426720361753968677", "湾湾小何"),
		voiceEntry("7566932564049428534", "粤语小溏"),
		voiceEntry("7481299960428855335", "东北老铁"),
		voiceEntry("7481299960428871719", "广西表哥"),
		voiceEntry("7481299960428888103", "港剧男神"),
		voiceEntry("7481299960428904487", "广东女仔"),
		voiceEntry("7481299960428920871", "重庆小伙"),
		voiceEntry("7524987545197756435", "广州德哥（多情感）"),
		voiceEntry("7524987545197772819", "高冷御姐（多情感）"),
		voiceEntry("7524987545197789203", "邻居阿姨（多情感）"),
		voiceEntry("7524987545197805587", "爽快思思（多情感）"),
		voiceEntry("7524987545197821971", "柔美女友（多情感）"),
		voiceEntry("7524987545197838355", "俊朗男友（多情感）"),
		voiceEntry("7524987545197854739", "傲娇霸总（多情感）"),
		voiceEntry("7524987545197871123", "儒雅男友（多情感）"),
		voiceEntry("7524987545197887507", "甜心小美（多情感）"),
		voiceEntry("7524987545197903891", "阳光青年（多情感）"),
		voiceEntry("7524987545197920275", "魅力女友（多情感）"),
		voiceEntry("7524987545197936659", "优柔公子（多情感）"),
		voiceEntry("7524987545197953043", "京腔侃爷（多情感）"),
		voiceEntry("7524987545197969427", "北京小爷（多情感）"),
		voiceEntry("7426720361753935909", "Alvin"),
		voiceEntry("7426720361732997129", "Brayan"),
		voiceEntry("7426720361753919525", "Skye"),
		voiceEntry("7468512265134784563", "Shiny"),
		voiceEntry("7468512265151447067", "Lily"),
		voiceEntry("7468512265151643675", "Candy"),
		voiceEntry("7426720361753886757", "Harmony"),
		voiceEntry("7468512265151545371", "Morgan"),
		voiceEntry("7468512265151578139", "Hope"),
		voiceEntry("7468512265151692827", "Cutey"),
		voiceEntry("7426720361754050597", "あけみ（朱美）"),
		voiceEntry("7426720361754017829", "かずね（和音）"),
		voiceEntry("7426720361753985061", "はるこ（晴子）"),
		voiceEntry("7426720361754066981", "ひろし（広志）"),
		voiceEntry("7481299960428822567", "气质女声"),
		voiceEntry("7481299960428838951", "日语男声"),
		voiceEntry("7426720361754001445", "Esmeralda"),
		voiceEntry("7426720361754034213", "Javier or Álvaro"),
		voiceEntry("7426720361754083365", "Roberto"),
	}
}

// newManifest 供测试构造任意清单。
func newManifest(entries ...ManifestEntry) Manifest {
	return staticManifest{entries: entries}
}

// voiceEntry 构造一条官方音色条目。它只是音频这一类素材的便捷构造：后续预置形象/场景/
// 道具等图片类官方素材可仿此各写一个便捷构造（如 characterEntry），填对应的 Type /
// MediaType / 扩展名 / ContentType，对账与上传链路本身对素材类型无关，无需改动。
//
// 展示名与插槽名同为音色名：官方 Resource 只有一个插槽，让两者一致可避免额外造名规则。
//
// FileName 由音色名推导为「音色名.mp3」：这批预置音频的文件名去掉后缀恰好等于音色名，
// 因此无需逐条另记文件名。上传链路据此填充内部 Asset 的 FileName（发送给模型的原始文件名
// 与用户自上传音频一致）。素材字节按 slug 从 runtime/preset-assets 目录读取，与 FileName
// 解耦，避免文件名中的空格/非 ASCII 影响文件系统键。
func voiceEntry(slug, name string) ManifestEntry {
	return ManifestEntry{
		Slug:        slug,
		Type:        domainresource.TypeAudio,
		Name:        name,
		SlotName:    name,
		FileName:    name + ".mp3",
		FileExt:     ".mp3",
		ContentType: "audio/mpeg",
		MediaType:   domainasset.MediaAudio,
	}
}

// audioEntry 供测试构造带文件名的音频条目。
func audioEntry(slug, name, fileName string) ManifestEntry {
	return ManifestEntry{
		Slug:        slug,
		Type:        domainresource.TypeAudio,
		Name:        name,
		SlotName:    "音色",
		FileName:    fileName,
		FileExt:     ".mp3",
		ContentType: "audio/mpeg",
		MediaType:   domainasset.MediaAudio,
	}
}
