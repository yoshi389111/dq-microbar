// @ts-check
// ビットイメージのフォント情報(8x12)をSVGのpath要素のd属性に変換する一時使用スクリプト
//
// 使用方法:
//
// ```shell-session
// node convertBitimageToVector.js > font.js
// ```
//
// 生成された `font.js` を `index.html` に埋め込んで使用する。
"use strict";

/**
 * @typedef { readonly [number, number] } Coordinate
 * @typedef { Coordinate[] } VectorPath
 * @typedef { {from: Coordinate, to: Coordinate} } Edge
 */

/** 1文字の幅(ドット数) */
const WIDTH = 8;
/** 1文字の高さ(ドット数) */
const HEIGHT = 12;

/**
 * 座標(0,0)を表す定数
 * @type { Coordinate }
 */
const ZERO_COORD = Object.freeze([0, 0]);

/**
 * 0からn-1までの数値の配列を返す。簡易 range 関数。
 * @param { number } n 配列の要素数
 * @returns { number[] } 0からn-1までの数値の配列
 */
const rangeN = (n) => [...Array(n).keys()];

/**
 * valueが [min, max) の範囲内にあるかを返す
 * @param { number } min 最小値(この値を含む)
 * @param { number } value  チェックする値
 * @param { number } max 最大値(この値を含まない)
 * @returns { boolean } 範囲内にある場合にtrue、そうでない場合にfalse
 */
const between = (min, value, max) => min <= value && value < max;

/**
 * ビットイメージを返す
 * @param { number } height ビットイメージの高さ
 * @param { string } hexString 1文字分の16進数文字列
 * @returns { number[] } ビットイメージのバイト配列
 */
const hexStringToBitimage = (height, hexString) => {
  if (hexString.length !== height * 2) throw new Error("Invalid hex string");

  return rangeN(height)
    .map((i) => hexString.substring(i * 2, i * 2 + 2))
    .map((s) => parseInt(s, 16));
};

/**
 * ビットイメージから、エッジ（反時計回り）を生成
 * @param { number } width ビットイメージの幅
 * @param { number } height ビットイメージの高さ
 * @param { function(number, number): boolean } existsDot 座標(x,y)にドットが存在するか確認する関数
 * @returns { Generator<Edge> } エッジのジェネレータ
 */
const generateEdges = function* (width, height, existsDot) {
  for (const y of rangeN(height)) {
    for (const x of rangeN(width)) {
      if (!existsDot(x, y)) {
        // 現在の位置にドットがなければエッジは不要
        continue;
      }
      if (!existsDot(x - 1, y)) {
        // 左のドットがない場合、左側のエッジ（反時計回り、つまり下向き）を追加
        yield { from: [x, y], to: [x, y + 1] };
      }
      if (!existsDot(x, y + 1)) {
        // 下のドットがない場合、下側のエッジ（反時計回り、つまり右向き）を追加
        yield { from: [x, y + 1], to: [x + 1, y + 1] };
      }
      if (!existsDot(x + 1, y)) {
        // 右のドットがない場合、右側のエッジ（反時計回り、つまり上向き）を追加
        yield { from: [x + 1, y + 1], to: [x + 1, y] };
      }
      if (!existsDot(x, y - 1)) {
        // 上のドットがない場合、上側のエッジ（反時計回り、つまり左向き）を追加
        yield { from: [x + 1, y], to: [x, y] };
      }
    }
  }
};

/**
 * 座標の一致チェック
 * @param { Coordinate } a 座標a
 * @param { Coordinate } b 座標b
 * @returns 同じ座標ならtrue、そうでない場合にfalse
 */
const areCoordinatesEqual = (a, b) => a[0] === b[0] && a[1] === b[1];

/**
 * 小さい座標を返す。
 * 具体的には、X座標が小さい方、X座標が同じ場合にはY座標が小さい方を返す。
 * @param { Coordinate } a 座標a
 * @param { Coordinate } b 座標b
 * @returns { Coordinate } 小さい座標
 */
const getMinimumCoordinate = (a, b) =>
  a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]) ? a : b;

/**
 * 一番左上の点を探す
 * @param { Edge[] } edges エッジのリスト
 * @returns { Coordinate | null } 左上の点の座標 or null
 */
const getTopLeftCoordinate = (edges) => {
  if (edges.length === 0) return null;
  return edges
    .map((e) => e.from)
    .reduce((p1, p2) => getMinimumCoordinate(p1, p2));
};

/**
 * 指定位置から始まるエッジを1つだけ取り出す。
 * 複数ある場合には最初に見つかった1つだけが対象。
 * 取り出したエッジは、引数のエッジのリストから取り除かれる。
 * @param { Edge[] } edges エッジのリスト
 * @param { Coordinate } from エッジの from
 * @returns { Edge | null } 取り出したエッジ or null
 */
const findAndRemoveEdge = (edges, from) => {
  const index = edges.findIndex((edge) => areCoordinatesEqual(edge.from, from));
  if (index === -1) return null;
  return edges.splice(index, 1)[0];
};

/**
 * 開始点から一筆書きでパスを抽出する、ただしパスが交差している場合にはすべてのパスを取得できない場合がある。
 * 抽出したエッジは、引数のエッジのリストから取り除かれる。
 * @param { Edge[] } edges エッジのリスト
 * @param { Coordinate } from 抽出するパスの始点
 * @returns { Generator<Coordinate> } 抽出したパス
 */
const extractPathSegment = function* (edges, from) {
  let edge = findAndRemoveEdge(edges, from);
  while (edge !== null) {
    yield edge.from;
    edge = findAndRemoveEdge(edges, edge.to);
  }
};

/**
 * パスと残りのエッジとで交点があるかを探す
 * @param { VectorPath } path パス
 * @param { Edge[] } edges エッジのリスト
 * @returns { number } 交点のみつかったパスの添え字 or -1
 */
const findIndexOfCrossPoint = (path, edges) =>
  path.findIndex((p) => edges.some((e) => areCoordinatesEqual(e.from, p)));

/**
 * 開始点から一筆書きでパスを抽出する。
 * 交差しているケースでもつながるパス全体を抽出する。
 * 抽出したエッジは、引数のエッジのリストから取り除かれる。
 * @param { Edge[] } edges エッジのリスト
 * @returns { VectorPath } 抽出したパス
 */
const extractPath = (edges) => {
  const from = getTopLeftCoordinate(edges);
  if (from === null) return [];

  const path = [...extractPathSegment(edges, from)];
  while (true) {
    const index = findIndexOfCrossPoint(path, edges);
    if (index === -1) break;
    const iter = extractPathSegment(edges, path[index]);
    path.splice(index, 0, ...iter);
  }

  // 同じ方向のエッジが続いている場合には、まとめる
  const simplifiedPath = path.filter((_, i) => {
    if (i === 0) return true;
    const [x1, y1] = path[i - 1];
    const [x2, y2] = path[(i + 1) % path.length];
    return x1 !== x2 && y1 !== y2;
  });
  return simplifiedPath;
};

/**
 * エッジのリストからパスのリストを抽出する。
 * @param { Edge[] } edges エッジのリスト
 * @returns { Generator<VectorPath> } 抽出したパスのジェネレータ
 */
const extractAllPaths = function* (edges) {
  while (edges.length > 0) {
    yield extractPath(edges);
  }
};

/**
 * 1つのパスをSVGのpath要素のd属性の文字列に変換
 * @param { Coordinate } from 現在の座標
 * @param { VectorPath } path パス
 * @returns { string } SVGのpath要素のd属性の文字列
 */
const toPathString = (from, path) =>
  path
    .map(([x, y], i) => {
      const [x0, y0] = i === 0 ? from : path[i - 1];
      const [dx, dy] = [x - x0, y - y0];
      if (i === 0) {
        return `m${dx} ${dy}`;
      } else if (dx === 0) {
        return `v${dy}`;
      } else {
        return `h${dx}`;
      }
    })
    .join("") + "z";

/**
 * パスの配列(1文字分)をSVGのpathのd属性の文字列に変換
 * @param { VectorPath[] } paths パスの配列(1文字分)
 * @returns { string } SVGのpathのd属性の文字列
 */
const toPathsString = (paths) =>
  paths
    .map((path, i) => {
      const from = i === 0 ? ZERO_COORD : paths[i - 1][0];
      return toPathString(from, path);
    })
    .join("");

/**
 * 16進文字列をSVGのpath要素のd属性の文字列に変換する
 * @param { string } hexString 1文字分の16進数文字列
 * @returns { string } SVGのpathのd属性の文字列
 */
const hexStringToPathString = (hexString) => {
  const bitimage = hexStringToBitimage(HEIGHT, hexString);

  /**
   * @param { number } x X座標
   * @param { number } y Y座標
   * @returns { boolean } ドットがある場合にtrue、そうでない場合にfalse
   */
  const existsDot = (x, y) =>
    between(0, x, WIDTH) &&
    between(0, y, HEIGHT) &&
    (bitimage[y] & (1 << x)) !== 0;

  const edges = [...generateEdges(WIDTH, HEIGHT, existsDot)];
  const paths = [...extractAllPaths(edges)];
  return toPathsString(paths);
};

/**
 * Mapに詰め込む1行分のソースを出力
 * @param { string } char キーとなる文字
 * @param { string } pathString SVGのpathのd属性の文字列
 */
const outputPathString = (char, pathString) => {
  console.log(`map.set("${char}", "${pathString}");`);
};

// ビットイメージのフォント情報を、キーとパス情報の値をマップに詰め込むソースに変換
// ビットイメージは横一列が1byte(8ドット)で、下位のbitが（右ではなく）左側になることに注意
outputPathString("０", hexStringToPathString("000000003c4242424242423c"));
outputPathString("１", hexStringToPathString("00000000080c08080808081c"));
outputPathString("２", hexStringToPathString("000000003c4240201804027e"));
outputPathString("３", hexStringToPathString("000000007e4020182040423c"));
outputPathString("４", hexStringToPathString("0000000030282422227e2020"));
outputPathString("５", hexStringToPathString("000000007e02023e4040423c"));
outputPathString("６", hexStringToPathString("000000003804023e4242423c"));
outputPathString("７", hexStringToPathString("000000007e42422010080808"));
outputPathString("８", hexStringToPathString("000000003c42423c4242423c"));
outputPathString("９", hexStringToPathString("000000003c4242427c402018"));
outputPathString("Ａ", hexStringToPathString("0000000000182442427e4242"));
outputPathString("Ｂ", hexStringToPathString("00000000003e42423e42423e"));
outputPathString("Ｃ", hexStringToPathString("00000000003c42020202423c"));
outputPathString("Ｄ", hexStringToPathString("00000000001e22424242221e"));
outputPathString("Ｅ", hexStringToPathString("00000000007e02023e02027e"));
outputPathString("Ｆ", hexStringToPathString("00000000007e02023e020202"));
outputPathString("Ｇ", hexStringToPathString("00000000003c42017141423c"));
outputPathString("Ｈ", hexStringToPathString("00000000004242427e424242"));
outputPathString("Ｉ", hexStringToPathString("00000000003e08080808083e"));
outputPathString("Ｊ", hexStringToPathString("00000000004040404042423c"));
outputPathString("Ｋ", hexStringToPathString("00000000004222120a162242"));
outputPathString("Ｌ", hexStringToPathString("00000000000202020202027e"));
outputPathString("Ｍ", hexStringToPathString("000000000041635549414141"));
outputPathString("Ｎ", hexStringToPathString("000000000041434549516141"));
outputPathString("Ｏ", hexStringToPathString("00000000001c22414141221c"));
outputPathString("Ｐ", hexStringToPathString("00000000003e42423e020202"));
outputPathString("Ｑ", hexStringToPathString("00000000001c22414151225c"));
outputPathString("Ｒ", hexStringToPathString("00000000003e42423e122242"));
outputPathString("Ｓ", hexStringToPathString("00000000003c42023c40423c"));
outputPathString("Ｔ", hexStringToPathString("00000000007f080808080808"));
outputPathString("Ｕ", hexStringToPathString("00000000004242424242423c"));
outputPathString("Ｖ", hexStringToPathString("000000000041412222141408"));
outputPathString("Ｗ", hexStringToPathString("000000000041414949555522"));
outputPathString("Ｘ", hexStringToPathString("000000000041221408142241"));
outputPathString("Ｙ", hexStringToPathString("000000000041412214080808"));
outputPathString("Ｚ", hexStringToPathString("00000000007e40201804027e"));
outputPathString("あ", hexStringToPathString("00000000043f043c66554926"));
outputPathString("い", hexStringToPathString("000000000021414141410906"));
outputPathString("う", hexStringToPathString("000000001c003c4240402018"));
outputPathString("え", hexStringToPathString("000000000c007e2010181472"));
outputPathString("お", hexStringToPathString("00000000445f043c46454526"));
outputPathString("か", hexStringToPathString("0000000004244f5412121509"));
outputPathString("き", hexStringToPathString("00000000043f083f1018011e"));
outputPathString("く", hexStringToPathString("000000002010080404081020"));
outputPathString("け", hexStringToPathString("000000002021792121212110"));
outputPathString("こ", hexStringToPathString("00000000001e20000002013e"));
outputPathString("が", hexStringToPathString("0040902004244f5412121509"));
outputPathString("ぎ", hexStringToPathString("00409020043f083f1018011e"));
outputPathString("ぐ", hexStringToPathString("004090202010080404081020"));
outputPathString("げ", hexStringToPathString("004090202021792121212110"));
outputPathString("ご", hexStringToPathString("00409020001e20000002013e"));
outputPathString("さ", hexStringToPathString("0000000004087f103001023c"));
outputPathString("し", hexStringToPathString("00000000020202020222221c"));
outputPathString("す", hexStringToPathString("00000000107f101e121c1008"));
outputPathString("せ", hexStringToPathString("0000000022227f222212023c"));
outputPathString("そ", hexStringToPathString("000000001e08047f08040438"));
outputPathString("ざ", hexStringToPathString("0040902004087f103001023c"));
outputPathString("じ", hexStringToPathString("00409020020202020222221c"));
outputPathString("ず", hexStringToPathString("00409020107f101e121c1008"));
outputPathString("ぜ", hexStringToPathString("0040902022227f222212023c"));
outputPathString("ぞ", hexStringToPathString("004090201e08047f08040438"));
outputPathString("た", hexStringToPathString("0000000004043f0472020971"));
outputPathString("ち", hexStringToPathString("0000000004043f043c42403c"));
outputPathString("つ", hexStringToPathString("0000000000003f404040300c"));
outputPathString("て", hexStringToPathString("00000000007f300804040830"));
outputPathString("と", hexStringToPathString("000000000404340c0201017e"));
outputPathString("だ", hexStringToPathString("0040902004043f0472020971"));
outputPathString("ぢ", hexStringToPathString("0040902004043f043c42403c"));
outputPathString("づ", hexStringToPathString("0040902000003f404040300c"));
outputPathString("で", hexStringToPathString("00409020007f300804040830"));
outputPathString("ど", hexStringToPathString("004090200404340c0201017e"));
outputPathString("な", hexStringToPathString("0000000004244f02111c321c"));
outputPathString("に", hexStringToPathString("000000000079010101010579"));
outputPathString("ぬ", hexStringToPathString("0000000010123a564b7555b2"));
outputPathString("ね", hexStringToPathString("000000000404374c44665574"));
outputPathString("の", hexStringToPathString("00000000001c2a4949494926"));
outputPathString("は", hexStringToPathString("000000002079212121792539"));
outputPathString("ひ", hexStringToPathString("000000000f2462212111110e"));
outputPathString("ふ", hexStringToPathString("000000000c1000081251510c"));
outputPathString("へ", hexStringToPathString("0000000000040a1120400000"));
outputPathString("ほ", hexStringToPathString("000000007921792139652539"));
outputPathString("ば", hexStringToPathString("004090202079212121792539"));
outputPathString("び", hexStringToPathString("004090200f2462212111110e"));
outputPathString("ぶ", hexStringToPathString("004090200c1000081251510c"));
outputPathString("べ", hexStringToPathString("0040902000040a1120400000"));
outputPathString("ぼ", hexStringToPathString("004090207921792139652539"));
outputPathString("ぱ", hexStringToPathString("00e0a0e02079212121792539"));
outputPathString("ぴ", hexStringToPathString("00e0a0e00f2462212111110e"));
outputPathString("ぷ", hexStringToPathString("00e0a0e00c1000081251510c"));
outputPathString("ぺ", hexStringToPathString("00e0a0e000040a1120400000"));
outputPathString("ぽ", hexStringToPathString("00e0a0e07921792139652539"));
outputPathString("ま", hexStringToPathString("00000000107c107c103c521c"));
outputPathString("み", hexStringToPathString("000000001e0848487e452512"));
outputPathString("む", hexStringToPathString("00000000044f44040645473c"));
outputPathString("め", hexStringToPathString("0000000010121a36534d4926"));
outputPathString("も", hexStringToPathString("0000000004041f041f044438"));
outputPathString("や", hexStringToPathString("0000000012123f424a320204"));
outputPathString("ゆ", hexStringToPathString("00000000103d53515155380c"));
outputPathString("よ", hexStringToPathString("0000000008380808080e192e"));
outputPathString("ら", hexStringToPathString("000000000c10023a46402018"));
outputPathString("り", hexStringToPathString("000000002222222224201008"));
outputPathString("る", hexStringToPathString("000000003e100c3e414c4a3c"));
outputPathString("れ", hexStringToPathString("000000000404374c44262544"));
outputPathString("ろ", hexStringToPathString("000000003e10083c4240403c"));
outputPathString("わ", hexStringToPathString("000000000404374c44464524"));
outputPathString("を", hexStringToPathString("00000000081e042c1a140438"));
outputPathString("ん", hexStringToPathString("00000000101008081c141262"));
outputPathString("ぁ", hexStringToPathString("0000000000040f041e2d2713"));
outputPathString("ぃ", hexStringToPathString("000000000000112121212502"));
outputPathString("ぅ", hexStringToPathString("00000000000e000e11100806"));
outputPathString("ぇ", hexStringToPathString("00000000000007000f04061d"));
outputPathString("ぉ", hexStringToPathString("0000000000042f041e252512"));
outputPathString("っ", hexStringToPathString("000000000000000f10100806"));
outputPathString("ゃ", hexStringToPathString("00000000000a3e2b221c0404"));
outputPathString("ゅ", hexStringToPathString("0000000000081d2b29291c08"));
outputPathString("ょ", hexStringToPathString("000000000000041c04060d16"));
outputPathString("ゎ", hexStringToPathString("000000000000021b26222312"));
outputPathString("ア", hexStringToPathString("000000007f48482814040402"));
outputPathString("イ", hexStringToPathString("000000002010080c0b080808"));
outputPathString("ウ", hexStringToPathString("0000000008087f414140201c"));
outputPathString("エ", hexStringToPathString("00000000003e08080808087f"));
outputPathString("オ", hexStringToPathString("0000000010107f1814141218"));
outputPathString("カ", hexStringToPathString("0000000008087f4848445221"));
outputPathString("キ", hexStringToPathString("0000000008087f087f080808"));
outputPathString("ク", hexStringToPathString("000000007c4442602010100c"));
outputPathString("ケ", hexStringToPathString("0000000002027e121110100c"));
outputPathString("コ", hexStringToPathString("00000000007e40404040407f"));
outputPathString("ガ", hexStringToPathString("0040902008087f4848445221"));
outputPathString("ギ", hexStringToPathString("0040902008087f087f080808"));
outputPathString("グ", hexStringToPathString("004090207c4442602010100c"));
outputPathString("ゲ", hexStringToPathString("0040902002027e121110100c"));
outputPathString("ゴ", hexStringToPathString("00409020007e40404040407f"));
outputPathString("サ", hexStringToPathString("0000000024247f242430100c"));
outputPathString("シ", hexStringToPathString("00000000000e404e4020100e"));
outputPathString("ス", hexStringToPathString("00000000007f201008142241"));
outputPathString("セ", hexStringToPathString("0000000002027f422202027c"));
outputPathString("ソ", hexStringToPathString("00000000004242442020100c"));
outputPathString("ザ", hexStringToPathString("0040902024247f242430100c"));
outputPathString("ジ", hexStringToPathString("00409020000e404e4020100e"));
outputPathString("ズ", hexStringToPathString("00409020007f201008142241"));
outputPathString("ゼ", hexStringToPathString("0040902002027f422202027c"));
outputPathString("ゾ", hexStringToPathString("00409020004242442020100c"));
outputPathString("タ", hexStringToPathString("000000007c44445a6020100c"));
outputPathString("チ", hexStringToPathString("00000000201e107f10100806"));
outputPathString("ツ", hexStringToPathString("000000000a4a4a402020100c"));
outputPathString("テ", hexStringToPathString("000000003e00007f10100804"));
outputPathString("ト", hexStringToPathString("000000000008080818280808"));
outputPathString("ダ", hexStringToPathString("004090207c44445a6020100c"));
outputPathString("ヂ", hexStringToPathString("00409020201e107f10100806"));
outputPathString("ヅ", hexStringToPathString("004090200a4a4a402020100c"));
outputPathString("デ", hexStringToPathString("004090203e00007f10100804"));
outputPathString("ド", hexStringToPathString("004090200008080818280808"));
outputPathString("ナ", hexStringToPathString("0000000010107f1010080806"));
outputPathString("ニ", hexStringToPathString("00000000003e00000000007f"));
outputPathString("ヌ", hexStringToPathString("00000000007e402028102846"));
outputPathString("ネ", hexStringToPathString("0000000008087f20182e4908"));
outputPathString("ノ", hexStringToPathString("000000004040202010080403"));
outputPathString("ハ", hexStringToPathString("000000000010222242414000"));
outputPathString("ヒ", hexStringToPathString("000000000202721e0202027c"));
outputPathString("フ", hexStringToPathString("00000000007e40402020100c"));
outputPathString("ヘ", hexStringToPathString("0000000000040a1120400000"));
outputPathString("ホ", hexStringToPathString("0000000008087f082a4a4908"));
outputPathString("バ", hexStringToPathString("004090200010222242414000"));
outputPathString("ビ", hexStringToPathString("004090200202721e0202027c"));
outputPathString("ブ", hexStringToPathString("00409020007e40402020100c"));
outputPathString("ベ", hexStringToPathString("0040902000040a1120400000"));
outputPathString("ボ", hexStringToPathString("0040902008087f082a4a4908"));
outputPathString("パ", hexStringToPathString("00e0a0e00010222242414000"));
outputPathString("ピ", hexStringToPathString("00e0a0e00202721e0202027c"));
outputPathString("プ", hexStringToPathString("00e0a0e0007e40402020100c"));
outputPathString("ペ", hexStringToPathString("00e0a0e000040a1120400000"));
outputPathString("ポ", hexStringToPathString("00e0a0e008087f082a4a4908"));
outputPathString("マ", hexStringToPathString("00000000007f404020140810"));
outputPathString("ミ", hexStringToPathString("000000003c00003c00003e40"));
outputPathString("ム", hexStringToPathString("00000000000808042442724f"));
outputPathString("メ", hexStringToPathString("000000002020201418280403"));
outputPathString("モ", hexStringToPathString("00000000003e04047f040478"));
outputPathString("ヤ", hexStringToPathString("0000000000047f4424080808"));
outputPathString("ユ", hexStringToPathString("00000000001e10101010107f"));
outputPathString("ヨ", hexStringToPathString("00000000003e20203c20203e"));
outputPathString("ラ", hexStringToPathString("00000000003e007f4020100c"));
outputPathString("リ", hexStringToPathString("000000002222222224201008"));
outputPathString("ル", hexStringToPathString("00000000000a0a0a0a0a4a39"));
outputPathString("レ", hexStringToPathString("000000000002020242221a06"));
outputPathString("ロ", hexStringToPathString("00000000007e424242427e00"));
outputPathString("ワ", hexStringToPathString("00000000007e424240402018"));
outputPathString("ヲ", hexStringToPathString("00000000007e407e4020100c"));
outputPathString("ン", hexStringToPathString("0000000000004e404020100e"));
outputPathString("ァ", hexStringToPathString("000000000000003e28180804"));
outputPathString("ィ", hexStringToPathString("0000000000000010180e0808"));
outputPathString("ゥ", hexStringToPathString("00000000000000083e221008"));
outputPathString("ェ", hexStringToPathString("00000000000000003e08083e"));
outputPathString("ォ", hexStringToPathString("00000000000000103e18141a"));
outputPathString("ッ", hexStringToPathString("000000000000001515101806"));
outputPathString("ャ", hexStringToPathString("00000000000000043e280808"));
outputPathString("ュ", hexStringToPathString("000000000000001c1010103e"));
outputPathString("ョ", hexStringToPathString("000000000000001e101c101e"));
outputPathString("ヮ", hexStringToPathString("00000000000000001e121008"));
outputPathString("ヴ", hexStringToPathString("0040902008087f414140201c"));
outputPathString("、", hexStringToPathString("000000000000000002040810"));
outputPathString("。", hexStringToPathString("00000000000000000c12120c"));
outputPathString("．", hexStringToPathString("000000000000000000001818"));
outputPathString("：", hexStringToPathString("000000000018180000181800"));
outputPathString("？", hexStringToPathString("000000003c42423008080008"));
outputPathString("！", hexStringToPathString("000000000808080808080008"));
outputPathString("゛", hexStringToPathString("000000000912240000000000"));
outputPathString("゜", hexStringToPathString("000000000705070000000000"));
outputPathString("ー", hexStringToPathString("00000000000000007f000000"));
outputPathString("‥", hexStringToPathString("000000000000005555000000"));
outputPathString("…", hexStringToPathString("000000000000002a2a000000"));
outputPathString("・", hexStringToPathString("000000000000001818000000"));
outputPathString("「", hexStringToPathString("000000003c04040400000000"));
outputPathString("＞", hexStringToPathString("0000000000040c1c3c1c0c04"));
outputPathString("＊", hexStringToPathString("000000000008492a1c2a4908"));
outputPathString("■", hexStringToPathString("00000000ffffffffffffffff"));
outputPathString("▼", hexStringToPathString("0000000000007f3e1c080000"));
outputPathString("⇒", hexStringToPathString("000000000010307fff7f3010"));
outputPathString("♪", hexStringToPathString("000000000818284848280e07"));
outputPathString("武", hexStringToPathString("004090201c003c4240402018"));
outputPathString("経", hexStringToPathString("00000000001f01a1af41a1bf"));
outputPathString("階", hexStringToPathString("00000000000101015151512f"));
outputPathString("日", hexStringToPathString("0000000008411c3e3e1c4108"));
outputPathString("月", hexStringToPathString("000000000e1c383838381c0e"));
outputPathString("星", hexStringToPathString("0000000008087f3e1c3e3641"));
outputPathString("水", hexStringToPathString("0000000008081c3e7f7f7f3e"));
outputPathString("命", hexStringToPathString("0000000000367f7f3e3e1c08"));
outputPathString("呪", hexStringToPathString("000000007cfefe9292ee7c54"));
outputPathString("十", hexStringToPathString("0000000018187e7e18181818"));
