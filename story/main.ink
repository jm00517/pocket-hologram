// ==================================================================================================================
// 이건 스토리가 아니다. 기능 견본(템플릿)이다: 연출 태그, 선택지 태그(#nod #shake #on: #default #timer), 트리거,
// persona(), #input, #memory, 호감도 변수를 한 번씩 다 써 보는 짧은 투어. 진짜 스토리를 쓸 때는 이 파일을 통째로
// 바꾸면 된다. 형식은 story/README.md, 확인은 `node scripts/story-check.mjs` (컴파일 + 검사 + 무작위 플레이).
// 그녀의 대사는 일본어(가나/한자와 、。！？ー〜만: VOCALOID가 부를 수 있는 글자), 번역은 #ko: 자막.
// ==================================================================================================================
INCLUDE lib.ink
# speaker: ミク = miku
# player: 나

VAR affection = 0       // 호감도: 선택지, 쓰다듬기, 자유 대화에서 그녀가 느낀 기분이 더하고 뺀다
VAR player_name = ""    // #input 으로 받는다

-> intro

// ---- 처음 시작: Ink 맨 위 흐름 (start 이벤트에 걸린 노트가 없으니 이게 재생된다) ----

=== intro ===
#fade:in 1.2
#bgm:morning fade=2 vol=0.6
ミク: あ、きたきた！ #ko:아, 왔다 왔다! #expr:happy #motion:hi #fx:exclaim
ミク: はじめまして、ミクです。 #ko:처음 뵙겠습니다, 미쿠예요. #react:bounce
ミク: あなたのなまえは？ #ko:이름이 뭐예요? #state:listening
#input:player_name 이름을 알려 줘
ミク: よろしくね！ #ko:{player_name}, 잘 부탁해! #expr:smile hold #state:idle
ミク: いっしょに、すこしあるかない？ #ko:같이 좀 걸을래? #timer:12
* [응, 같이 걷자 #nod]
    ~ affection += 1
    -> walk_together
* [손을 내민다 #on:touch.hand]
    ~ affection += 2
    ミク: えっ、てをつなぐの？ #ko:어, 손 잡는 거야? #expr:shy #fx:heart
    -> walk_together
* [오늘은 여기 있을래 #shake]
    ミク: そっか、じゃあここでゆっくりしよ。 #ko:그렇구나, 그럼 여기서 쉬자. #expr:smile
    -> tour
* [잘 모르겠어 #default]
    ミク: ふふ、まよってるの？ #ko:후후, 고민 중이야? #expr:wink
    -> tour

=== walk_together ===
ミク: こっちこっち！ #ko:이쪽이야! #look:away #walk:1 -1
#face:you
ミク: ここ、すきなばしょなんだ。 #ko:여기, 내가 좋아하는 곳이야. #look:you #expr:happy hold
#wait:1.5
ミク: またいっしょにこようね。 #ko:또 같이 오자. #expr:shy len=3 #follow:on
#look:free
-> tour

// ---- 연출 투어: + 는 몇 번이고 고를 수 있는 선택지, * 는 한 번만 ----

=== tour ===
ミク: なにがみたい？ #ko:뭐 보고 싶어? #state:thinking
+ [표정과 몸짓]
    -> tour_body
+ [소리와 화면 효과]
    -> tour_fx
+ [맵과 시간]
    -> tour_world
+ [엔진 파라미터와 명령]
    -> tour_engine
+ 노래 불러 줘!
    // 대괄호 없이 쓴 선택지: 고른 글이 그대로 내 대사로 한 줄 나온다
    ミク: らーらーらー。 #ko:라~라~라~ #fx:note #motion:shy
    -> tour
* [이제 됐어]
    ミク: うん、またあとでね！ #ko:응, 이따 또 봐! #motion:byebye #bgm:stop fade=2
    -> DONE

=== tour_body ===
ミク: えがおと、 #ko:웃는 얼굴이랑, #expr:smile
ミク: びっくり！ #ko:깜짝이야! #expr:surprised #react:recoil #fx:exclaim
ミク: ぷんぷん。 #ko:흥이다. #expr:pout #fx:anger
ミク: ちょっとかんがえさせて。 #ko:잠깐 생각해 볼게. #state:thinking #look:up #fx:question
ミク: ピース！ #ko:브이! #hands:peace #expr:wink
{ has_motion("cheer"):
    ミク: やったー！ #ko:만세! #motion:cheer #fx:sparkle
- else:
    ミク: やったー！ #ko:만세! #react:bounce #fx:sparkle
}
#hands:auto
#look:free
#state:idle
-> tour

=== tour_fx ===
ミク: おとをならすね。 #ko:소리 낼게. #sfx:chime
ミク: ぽん！ #ko:퐁! #sfx:pop vol=0.8 #fx:note
#clear
#wait:0.8
ミク: ちょっとくらくするよ。 #ko:잠깐 어두워져. #style:whisper
#fade:out 0.8
#wait:0.5
#fade:in 0.8
조용한 바람이 분다.
ミク: これはこえなし。 #ko:이건 목소리 없이. #voice:off
ミク: 明日もあおうね。 #yomi:あしたもあおうね。 #ko:내일도 만나자.
ミク: じどうでつぎにいくよ。 #ko:자동으로 다음으로 넘어가. #auto:2
-> tour

=== tour_world ===
ミク: いまは{period() == "night":よる|ひる}だね。 #ko:지금은 {period() == "night":밤|낮}이네.
ミク: ゆうがたにしてみよう。 #ko:저녁으로 해 보자. #time:evening
ミク: よるもすてき。 #ko:밤도 멋져. #time:night #fx:zzz
{ vr():
    ミク: てをのばしてみて。 #ko:손을 뻗어 봐. #face:you
}
+ [교실로 가 보자]
    #fade:out 0.6
    #map:classroom
    #place:0 0 0
    #fade:in 0.6
    ミク: きょうしつについたよ。 #ko:교실에 도착했어. #look:left
+ [여기 있자]
- ミク: そらはほんもののじかんにもどすね。 #ko:하늘은 진짜 시간으로 돌려 둘게. #set:time.real=1
-> tour

=== tour_engine ===
ミク: ちょっとまぶしくするね。 #ko:좀 눈부시게 할게. #set:post.bloom=0.9
ミク: もどすね。 #ko:되돌릴게. #set:post.bloom=0.35
ミク: カメラももとどおり。 #ko:카메라도 원래대로. #cmd:camera mode=rig
-> tour

// ---- 트리거: 장면이 없을 때(자유 모드) 이벤트가 오면 그 노트가 장면으로 재생된다 ----

=== welcome_back ===
# on: return
{ event_value >= 24:
    ミク: ひさしぶり！あいたかったよ。 #ko:오랜만이야! 보고 싶었어. #expr:happy #motion:wave #fx:heart
- else:
    ミク: おかえり！ #ko:어서 와! #expr:smile #motion:hi
}
{ hour() >= 23 || hour() < 5:
    ミク: こんなじかんまでおきてるの？ #ko:이 시간까지 안 자는 거야? #expr:surprised
}
{ date() == "08-31":
    ミク: きょうはわたしのたんじょうび！ #ko:오늘은 내 생일이야! #fx:sparkle
}
{ memory("first_highfive") && visits() >= 10:
    ミク: もうすっかりなかよしだね。 #ko:이제 완전 친해졌네. #expr:wink
}
-> DONE

=== back_again ===
# on: back
# cooldown: 60
ミク: あ、もどってきた。 #ko:아, 돌아왔다. #expr:smile #look:you
-> DONE

=== new_place ===
# on: map.*
# cooldown: 30
ミク: わあ、ここはどこ？ #ko:와, 여기는 어디야? #expr:surprised #look:left
#look:free
-> DONE

=== pool_side ===
# on: map.pool
# priority: 1
ミク: プールだ！みずがつめたそう。 #ko:수영장이다! 물이 차가워 보여. #expr:happy #fx:sparkle
-> DONE

=== head_pat ===
# on: touch.headpat
# cooldown: 20
~ affection += 1
ミク: えへへ、くすぐったい。 #ko:헤헤, 간지러워. #expr:shy #fx:heart
-> DONE

=== head_pat_close ===
# on: touch.headpat
# priority: 1
# cooldown: 20
# when: close
~ affection += 1
ミク: もっとなでて。 #ko:더 쓰다듬어 줘. #expr:heart hold len=4 #style:whisper
-> DONE

=== cheek_poke ===
# on: touch.poke
# cooldown: 10
ミク: {event_value < 0:ひだり|みぎ}のほっぺ、つつかないで！ #ko:{event_value < 0:왼쪽|오른쪽} 볼 찌르지 마! #expr:pout #react:recoil
-> DONE

// #memory: 추억 갤러리에 들어가고, 메뉴에서 이 노트를 처음부터 다시 볼 수 있다. 다시 보기는 노트 끝까지 재생되니
// -> DONE 으로 끝나는 노트(여기처럼)에 둔다. 다시 보기가 끝나면 상태(변수)는 그 전으로 돌아간다.
=== first_highfive ===
# on: touch.highfive
# once
ミク: いえーい！はじめてのハイタッチ！ #ko:예이! 첫 하이파이브! #expr:happy #sfx:pop #memory:first_highfive 첫 하이파이브
-> DONE

=== hold_hands ===
# on: touch.hand
# cooldown: 30
# chance: 0.7
ミク: て、あったかいね。 #ko:손, 따뜻하네. #expr:shy hold #look:down
#look:free
-> DONE

=== too_close ===
# on: near
# cooldown: 45
ミク: ちかいよ。 #ko:가까워. #expr:shy #style:whisper #fx:sweat
-> DONE

=== staring ===
# on: gaze
# cooldown: 60
# chance: 0.5
ミク: そんなにみつめられたら、てれちゃう。 #ko:그렇게 쳐다보면 부끄러워. #expr:shy #look:away
+ [계속 바라본다 #nod]
    ~ affection += 1
    ミク: もう！ #ko:정말! #expr:pout #fx:heart
+ [눈을 돌린다 #shake #default #timer:8]
    ミク: ふふ。 #ko:후후. #expr:smile
- #look:free
-> DONE

=== on_chat ===
# on: chat
// 자유 대화 한 번마다: 그녀가 느낀 기분(-2..2)이 호감도에 더해진다. 대사 없는 장면.
~ affection += event_value
-> DONE

=== bored ===
# on: idle
# cooldown: 300
ミク: ねえ、ひま？ #ko:저기, 심심해? #react:tilt #auto:4
-> DONE

=== good_night ===
# on: time.night
# priority: 1
ミク: もうよるだね。おやすみのじかん？ #ko:벌써 밤이네. 잘 시간이야? #expr:smile #fx:zzz
-> DONE

=== sky_changes ===
# on: time.*
# cooldown: 600
ミク: そらのいろがかわったね。 #ko:하늘 색이 바뀌었네. #look:up
#look:free
-> DONE

// ---- 함수: when 조건과, 자유 대화(LLM)에 덧붙는 그녀의 성격 ----

=== function close() ===
~ return affection >= 5

=== function persona() ===
{ player_name != "":
    ユーザーの名前は{player_name}。
}
{
- affection >= 10:
    ユーザーとは恋人同士。甘えた口調で、名前で呼ぶ。
- affection >= 3:
    ユーザーとは仲のいい友だち。くだけた口調で話す。
- else:
    ユーザーとは知り合ったばかり。少し丁寧に話す。
}
