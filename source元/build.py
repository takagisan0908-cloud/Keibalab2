#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""keiba-lab 単一HTML(index.html)を src/ から再ビルドする。
   p1_head.html + p2_body.html + <script> + JS + 埋め込みコース画像 + </script>
   実行: python3 build.py
   ・src/cimg/*.jpg|gif は dataURI に変換され、JS の COURSE_IMAGES として index.html に埋め込まれる
     （アプリを単一HTMLのまま配布でき、外部参照なしでコース図を表示できる）"""
import glob, re, os, base64, mimetypes

ORDER = [
    'p00_fflate',   # 圧縮ライブラリ（MIT・同期API）— 必ず最初
    'p3_core', 'p4_parse', 'p5_engine', 'p6_inputui', 'p7_import',
    'p8_analysisui', 'p9_sim',
    'p12_urlimport', 'p13_bias', 'p14_history', 'p15_styleai',
    'p16_umasiru', 'p17_jra', 'p18_racesearch', 'p19_memo',
    'p21_resultnotes', 'p22_learn', 'p23_course',
    'p25_horsebook', 'p26_kaisai', 'p27_jravideo', 'p29_pedigree', 'p30_learnrec',
    'p31_bloodfactor', 'p32_dateimport', 'p33_racepicker', 'p34_horsedetail', 'p35_nav', 'p36_datarace',
    'p37_betcalc', 'p38_live', 'p39_gradecal',
    'p40_netkeiba',  # netkeiba代替抽出(jiro8廃止後)
    'p41_courserec', # 中央コースレコード表(結果画面の記録判定)
    'p43_baba',    # バ場・馬場別好走率(同開催場×同馬場3着内率)ファクター
    'p45_yoso',    # コース種別(洋芝/野芝)適性・競馬場別持ちタイム
    'p46_tenki',   # 天気予報タブ(tenki.jp を競馬場の郵便番号で引く)
    'p44_aihorse', # 馬柱AI評価(芝/ダ替わり・得意コース距離馬場)
    'p47_timelv',  # 勝ちタイムのレベル(2・3歳 未勝利〜3勝クラス)→短評・🎯/⚠️バッジ
    'p48_racedata',# 結果ページの追加情報(コーナー通過順・ペース・200mラップ・払戻)を抽出
    'p49_jockeylay',# 騎手成績・乗り替わり・○ヶ月休養・鉄砲・2走目(馬柱戦績から計算)
    'p50_pacefit', # 展開(ペース)適性×コーナー通過順バイアスの学習(学習DBから集計)
    'p51_apdiag', # AI予想の診断(人気依存・市場比リフト・基準線比較) ※計測のみで印は変えない
    'p52_histfeat',# 学習DBから「レース前の情報だけ」で馬ごとの特徴量を作る(いかさま防止)
    'p53_prefetch',# 出走前の出馬表一括取得→AI予想の「事前予想」を保存(結果と照合して学習)
    'p54_factorlearn',# 提案4: ファクター別の学習(どの材料が効いているかを測って重みを自動調整)
    'p55_betpro',  # 買い目提案(詳細版): 3連系・オッズ妙味(edge)・分数ケリーで金額を自動割り振り
    'p56_picks',   # 各レースの🎯軸に最適馬・💠妙味馬・🕳穴馬を1頭ずつ選ぶ＋その日の一覧
    'p57_prevbias',# 前日の馬場を検出して当日のトラックバイアス想定にする(日曜開催/日曜+月曜開催に対応)
    'p58_value',   # ★第19弾②: 回収率チューナー（予想×実払戻で買い方を総当たりし回収率の最良設定を探す）
    'p59_automacro',# ★第20弾: 🤖自動マクロ（他レース自動検出・全馬データ→上3F連鎖・未確定週の水曜自動削除・⑥→🧬血統連鎖）
    'p60_biasauto',# ★第21弾④: 🌊トラックバイアスを開催日に自動取得（発走+12分で確定見込み）＋開催週の水曜に自動削除
    'p61_wtauto',  # ★第21弾⑤: 🎛重みをレースごとに自動補正（オーバーレイ方式・スライダーは書き換えない）
    'p62_articleref',# ★第22弾: 📰記事からレース名を自動検出し、出馬表キャッシュ/学習DB/馬ノートを横断して該当馬を参照
                     #           （p25_horsebook / p12_urlimport / p18_racesearch / p30_learnrec のすべてより後）
    'p63_jockeydb',# ★第25弾②: 🏇 騎手・調教師DB（keibalab.jp 取得・パース・キャッシュ・名前→ID解決）
    'p64_jockeyui',# ★第25弾②: 🏇 騎手・調教師DBタブのUI（検索・絞り込み・成績表示）＋③ファクター配線
    'p10_main',  # 最後: boot() を含む
]

def read(p):
    with open(p, encoding='utf-8') as f:
        return f.read()

def course_images_js():
    """src/cimg の画像を dataURI 化して JS の COURSE_IMAGES 文字列を返す。
       ファイル名: <場slug>_3d.jpg (立体図) / <場slug>_heimenzu.gif (平面図)"""
    mime = {'.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp'}
    parts = ['var COURSE_IMAGES = {']
    first = True
    for p in sorted(glob.glob('src/cimg/*')):
        ext = os.path.splitext(p)[1].lower()
        if ext not in mime:
            continue
        base = os.path.basename(p)[: -len(ext)]
        with open(p, 'rb') as f:
            b64 = base64.b64encode(f.read()).decode('ascii')
        if not first:
            parts.append(',')
        parts.append('\n  %s: "data:%s;base64,%s"' % (base, mime[ext], b64))
        first = False
    parts.append('\n};')
    if first:
        return 'var COURSE_IMAGES = {};'
    return ''.join(parts)

def build_id():
    """src/VERSION の1行目をビルド番号として返す（無ければ 'dev'）。
       HTML 内の __BUILD_ID__ をこの値に置換するので、
       「今開いているページがどの版か」を画面から一目で確認できる。"""
    try:
        with open('src/VERSION', encoding='utf-8') as f:
            s = f.read().strip().splitlines()
        return s[0].strip() if s else 'dev'
    except Exception:
        return 'dev'


def main():
    bid = build_id()
    head = read('src/p1_head.html')
    body = read('src/p2_body.html')
    head = head.replace('__BUILD_ID__', bid)
    body = body.replace('__BUILD_ID__', bid)
    parts = [head, body]
    parts.append('<script>\n')
    # 埋め込みコース画像（外部参照なし）
    parts.append('/* ===== src/cimg から自動埋め込みされたコース画像(dataURI) ===== */\n')
    parts.append(course_images_js())
    parts.append('\n\n')
    for name in ORDER:
        p = 'src/%s.js' % name
        if not os.path.exists(p):
            raise SystemExit('missing %s' % p)
        parts.append(read(p))
        parts.append('\n')
    parts.append('</script>\n</body>\n</html>\n')
    out = ''.join(parts)
    with open('index.html', 'w', encoding='utf-8') as f:
        f.write(out)
    kb = os.path.getsize('index.html') / 1024
    print('index.html rebuilt: %d bytes (%.0f KB) / %d chars' % (os.path.getsize('index.html'), kb, len(out)))

if __name__ == '__main__':
    main()
