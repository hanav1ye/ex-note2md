/**
 * ディレクトリを ZIP にまとめる（依存なし）。
 *
 * ストア提出用の zip を手で作ると、Windows PowerShell 5.1 の Compress-Archive は
 * パス区切りをバックスラッシュで書き（ZIP 仕様違反）、Git Bash の tar は GNU tar で
 * zip を作れない。どちらも「一見できたように見えて壊れている」ため、ビルドの一部として
 * ここで確実に生成する。
 *
 * 仕様は ZIP の基本形（ローカルヘッダ + セントラルディレクトリ + EOCD、Deflate 圧縮）だけを
 * 使い、パス区切りは常に "/"、ファイル名は UTF-8 フラグ付きで書く。
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { deflateRawSync } from "node:zlib";

/** CRC-32（ZIP が使う IEEE 802.3 多項式）のテーブル。 */
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

/**
 * バッファの CRC-32 を計算する。
 * @param {Buffer} buffer - 対象。
 * @returns {number} CRC-32。
 */
const crc32 = (buffer) => {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

/**
 * ZIP が使う DOS 形式の日時に変換する。
 * @param {Date} date - 変換元。
 * @returns {{time: number, date: number}} DOS 時刻と日付。
 */
const toDosDateTime = (date) => ({
  time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
  date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
});

/**
 * ディレクトリ配下のファイルを、ZIP 内パス順に並べて列挙する。
 * @param {string} root - 起点ディレクトリ。
 * @returns {{path: string, zipPath: string}[]} ファイル一覧。
 */
const collectFiles = (root) => {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (entry.isFile()) {
        files.push({ path, zipPath: relative(root, path).split("\\").join("/") });
      }
    }
  };
  walk(root);
  return files.sort((a, b) => (a.zipPath < b.zipPath ? -1 : 1));
};

/**
 * ディレクトリを ZIP ファイルに書き出す。
 * @param {string} sourceDir - まとめるディレクトリ。この中身が ZIP のルートになる。
 * @param {string} outputPath - 出力先 ZIP のパス。
 * @returns {{fileCount: number, bytes: number}} 書き出した件数とサイズ。
 */
export const zipDirectory = (sourceDir, outputPath) => {
  const files = collectFiles(sourceDir);
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const data = readFileSync(file.path);
    const compressed = deflateRawSync(data, { level: 9 });
    const nameBytes = Buffer.from(file.zipPath, "utf8");
    const crc = crc32(data);
    const { time, date } = toDosDateTime(statSync(file.path).mtime);
    // bit 11: ファイル名が UTF-8 であることを示す
    const flags = 0x0800;
    const method = 8; // Deflate

    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // 展開に必要なバージョン 2.0
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    nameBytes.copy(local, 30);

    const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // 作成側バージョン
    central.writeUInt16LE(20, 6); // 展開に必要なバージョン
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk number
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42);
    nameBytes.copy(central, 46);

    localParts.push(local, compressed);
    centralParts.push(central);
    offset += local.length + compressed.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  const output = Buffer.concat([...localParts, ...centralParts, eocd]);
  writeFileSync(outputPath, output);
  return { fileCount: files.length, bytes: output.length };
};
