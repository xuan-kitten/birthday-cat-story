这里放猫猫照片。文件名与剧情配置里的 img / bg 字段一致即可自动生效。

已实际使用的文件：
  1.jpeg                 选角节点 start 的背景（已绑定）

选角背景（按 mood 默认，可替换同名文件）：
  bg_night.jpg           悬疑 mystery
  bg_street.jpg          跟踪 tracking
  bg_home.jpg            日常 daily
  bg_warm.jpg            温暖 warm

角色配图占位文件名：
  cat_intro.gif
  cat_npc.gif
  cat_park_flower.gif
  cat_dog.gif
  cat_dog_chase.gif
  cat_act_cute.gif
  cat_can.gif
  cat_lost.gif
  cat_xiaohei_come.gif
  cat_cake.gif

选角选项头像（已绑定，使用 assets/opt/ 里的 512px 压缩版）：
  橘白猫.png  → opt/orange.webp
  狸花猫.png  → opt/tabby.webp
  简州猫.png  → opt/jianzhou.webp
  三花猫.png  → opt/calico.webp
  玄猫.png    → opt/black.webp
  白猫.png    → opt/white.webp
  奶牛猫.png  → opt/cow.webp

原图保留在 assets/ 根目录（约 10.6MB），页面实际加载的是 opt/ 里的压缩版（合计约 342KB）。
替换某只猫的图：用同名文件覆盖根目录原图，再在编辑模式里把新图拖到对应选项即可；
或者直接替换 assets/opt/ 里的同名 webp。
绑定方式：编辑模式 → 选中「你是谁？」节点 → 每个选项左侧的方块 → 选图 / 上传新图片。
播放时这些选项会以单只猫左右轮播展示，一次只显示一只，左右箭头或滑动切换，点「就选它」确认。

角色立绘（说话人，放在 assets/ 根目录，文件名用角色名）：
  小白.png / 小白.jpg / 小白.jpeg / 小白.webp / 小白.gif
  小黑.png / 小黑.jpg / 小黑.jpeg / 小黑.webp / 小黑.gif
  「我」的立绘不用单独放，使用玩家选中的猫（assets/opt/*.webp）。
  在编辑模式里给每个节点选择说话人：旁白 / 我 / 小白 / 小黑。

立绘也已压好 640px WebP：assets/opt/xiaobai.webp、assets/opt/xiaohei.webp
页面会优先加载压缩版，原图保留作备份。

两种使用方式：
1) 直接把文件丢进这个文件夹，名字保持一致（推荐，GIF 动图会正常播放）。
2) 在网页「编辑模式」里拖进对应区域：主舞台 = 角色配图，右侧「背景照片」= 背景。
   拖进去的图片存在浏览器 IndexedDB，同名图片优先使用 IndexedDB 版本，
   导出「完整包」时可以一起打包（直接放这里的文件不会嵌入 JSON）。

