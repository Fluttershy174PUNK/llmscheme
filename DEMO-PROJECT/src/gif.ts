// GIF output: renders a short animated TUI cat to a GIF file.
// Produces a 4-frame looping animation of the cat with the tail swaying.
//
// No external deps. Uses a tiny hand-rolled GIF89a encoder (LZW + global
// colour table) so the demo stays zero-dependency. Suitable for 16-colour
// pixel art at small sizes.
import { renderCat } from "./cat.ts";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORDS_FILE = path.join(HERE, "..", "cats.txt");

// ---- minimal LZW for GIF ----
function lzwCompress(indices: number[], minCodeSize: number): Uint8Array {
	const CLEAR = 1 << minCodeSize;
	const EOI = CLEAR + 1;
	let dict = new Map<string, number>();
	for (let i = 0; i < CLEAR; i++) dict.set(String.fromCharCode(i), i);
	let codeSize = minCodeSize + 1;
	let nextCode = EOI + 1;
	let buf = "";
	const out: number[] = [];
	let bits = 0;
	let nbits = 0;
	const emit = (code: number) => {
		bits |= code << nbits;
		nbits += codeSize;
		while (nbits >= 8) {
			out.push(bits & 0xff);
			bits >>>= 8;
			nbits -= 8;
		}
	};
	emit(CLEAR);
	for (const idx of indices) {
		const c = String.fromCharCode(idx);
		const k = buf + c;
		if (dict.has(k)) {
			buf = k;
		} else {
			emit(dict.get(buf) ?? 0);
			if (nextCode < 4096) {
				dict.set(k, nextCode++);
				if (nextCode > 1 << codeSize && codeSize < 12) codeSize++;
			} else {
				emit(CLEAR);
				dict = new Map();
				for (let i = 0; i < CLEAR; i++) dict.set(String.fromCharCode(i), i);
				nextCode = EOI + 1;
				codeSize = minCodeSize + 1;
			}
			buf = c;
		}
	}
	if (buf) emit(dict.get(buf) ?? 0);
	emit(EOI);
	if (nbits > 0) out.push(bits & 0xff);
	return new Uint8Array(out);
}

// ---- GIF89a writer ----
function writeGif(
	frames: { width: number; height: number; pixels: Uint8Array; delayCs: number }[],
	out: { write: (b: Uint8Array) => void },
	loop = true,
) {
	const w = frames[0]!.width;
	const h = frames[0]!.height;

	// global header
	out.write(new TextEncoder().encode("GIF89a"));
	// logical screen descriptor
	const lsd = new Uint8Array(7);
	lsd[0] = w & 0xff;
	lsd[1] = (w >> 8) & 0xff;
	lsd[2] = h & 0xff;
	lsd[3] = (h >> 8) & 0xff;
	// global colour table flag (0x80) + colour resolution (7) + sort flag (0) + global GCT size (7 = 256 entries)
	lsd[4] = 0x80 | 0x70 | 0x07;
	// background colour index + pixel aspect ratio
	lsd[5] = 0;
	lsd[6] = 0;
	out.write(lsd);

	// global colour table: 256 entries, 3 bytes each = 768 bytes
	// build a 256-colour palette: 16 ANSI + 6×6×6 RGB cube + greyscale ramp
	const gct = new Uint8Array(256 * 3);
	const set = (i: number, r: number, g: number, b: number) => {
		gct[i * 3] = r;
		gct[i * 3 + 1] = g;
		gct[i * 3 + 2] = b;
	};
	// first 16: ANSI colours
	const ansi = [
		[0, 0, 0],
		[128, 0, 0],
		[0, 128, 0],
		[128, 128, 0],
		[0, 0, 128],
		[128, 0, 128],
		[0, 128, 128],
		[192, 192, 192],
		[128, 128, 128],
		[255, 0, 0],
		[0, 255, 0],
		[255, 255, 0],
		[0, 0, 255],
		[255, 0, 255],
		[0, 255, 255],
		[255, 255, 255],
	];
	ansi.forEach((c, i) => {
		set(i, c[0]!, c[1]!, c[2]!);
	});
	// 216-colour cube (indices 16-231)
	for (let r = 0; r < 6; r++) {
		for (let g = 0; g < 6; g++) {
			for (let b = 0; b < 6; b++) {
				const i = 16 + r * 36 + g * 6 + b;
				set(i, r > 0 ? r * 51 + 51 : 0, g > 0 ? g * 51 + 51 : 0, b > 0 ? b * 51 + 51 : 0);
			}
		}
	}
	// 24-step greyscale ramp (232-255)
	for (let i = 0; i < 24; i++) {
		const v = Math.round(((i + 1) * 255) / 25);
		set(232 + i, v, v, v);
	}
	out.write(gct);

	// application extension: NETSCAPE2.0 for looping
	{
		const ext = new Uint8Array([
			0x21,
			0xff,
			0x0b,
			0x4e,
			0x45,
			0x54,
			0x53,
			0x43,
			0x41,
			0x50,
			0x45,
			0x32,
			0x2e,
			0x30,
			0x03,
			0x01,
			loop ? 0xff : 0x00,
			0x00, // loop forever
			0x00,
		]);
		out.write(ext);
	}

	// each frame: graphic control extension + image descriptor + LZW data
	for (const frame of frames) {
		// graphic control extension
		const gce = new Uint8Array(8);
		gce[0] = 0x21; // extension
		gce[1] = 0xf9; // GCE label
		gce[2] = 0x04; // block size
		gce[3] = 0x00; // packed (no transparent colour)
		gce[4] = frame.delayCs & 0xff;
		gce[5] = (frame.delayCs >> 8) & 0xff;
		gce[6] = 0x00; // transparent colour index (unused)
		gce[7] = 0x00; // block terminator
		out.write(gce);

		// image descriptor
		const id = new Uint8Array(10);
		id[0] = 0x2c; // image separator
		id[1] = 0;
		id[2] = 0; // left
		id[3] = 0;
		id[4] = 0; // top
		id[5] = frame.width & 0xff;
		id[6] = (frame.width >> 8) & 0xff;
		id[7] = frame.height & 0xff;
		id[8] = (frame.height >> 8) & 0xff;
		id[9] = 0x00; // no local colour table
		out.write(id);

		// LZW minimum code size
		const minCodeSize = 8; // 256-colour palette
		out.write(new Uint8Array([minCodeSize]));

		// LZW-compressed data, broken into sub-blocks (max 255 bytes)
		const compressed = lzwCompress(Array.from(frame.pixels), minCodeSize);
		for (let i = 0; i < compressed.length; i += 255) {
			const slice = compressed.slice(i, i + 255);
			out.write(new Uint8Array([slice.length]));
			out.write(slice);
		}
		out.write(new Uint8Array([0])); // block terminator
	}

	// trailer
	out.write(new Uint8Array([0x3b]));
}

// ---- render an ANSI text frame to a pixel buffer ----
function textFrameToPixels(text: string, width: number, height: number): Uint8Array {
	const out = new Uint8Array(width * height).fill(0); // background = colour 0 (black)
	// simple 5x7 bitmap font for the visible ASCII subset
	const font = bitmapFont();
	for (let y = 0; y < height && y < 8; y++) {
		let x = 0;
		for (const ch of text) {
			if (x + 5 >= width) break;
			const glyph = font[ch] ?? font["?"]!;
			for (let dx = 0; dx < 5; dx++) {
				const on = (glyph[y] >> (4 - dx)) & 1;
				if (on) {
					const px = x + dx;
					if (px < width) {
						// colour the cat: head = orange (idx 214), body = white, tail = yellow
						const colour = y < 2 ? 214 : y < 4 ? 255 : 220;
						out[y * width + px] = colour;
					}
				}
			}
			x += 6; // 5 + 1 spacing
		}
	}
	return out;
}

// ---- minimal 5x7 bitmap font ----
// 32 chars: A-Z, 0-9, space, and a few punctuation marks
function bitmapFont(): Record<string, number[]> {
	const data: Record<string, number> = {
		" ": [0, 0, 0, 0, 0, 0, 0],
		"!": [4, 4, 4, 4, 0, 0, 4],
		"-": [0, 0, 8, 14, 8, 0, 0],
		".": [0, 0, 0, 0, 0, 12, 12],
		"0": [6, 9, 9, 9, 9, 9, 6],
		"1": [4, 12, 4, 4, 4, 4, 14],
		"2": [6, 9, 1, 2, 4, 8, 15],
		"3": [6, 9, 1, 6, 1, 9, 6],
		"4": [2, 6, 10, 14, 2, 2, 2],
		"5": [15, 8, 8, 14, 1, 9, 6],
		"6": [6, 8, 8, 14, 9, 9, 6],
		"7": [15, 1, 2, 4, 4, 4, 4],
		"8": [6, 9, 9, 6, 9, 9, 6],
		"9": [6, 9, 9, 7, 1, 9, 6],
		":": [0, 0, 12, 0, 0, 12, 0],
		"?": [6, 9, 1, 2, 4, 0, 4],
		A: [6, 9, 9, 15, 9, 9, 9],
		B: [14, 9, 9, 14, 9, 9, 14],
		C: [6, 9, 8, 8, 8, 9, 6],
		D: [14, 9, 9, 9, 9, 9, 14],
		E: [15, 8, 8, 14, 8, 8, 15],
		F: [15, 8, 8, 14, 8, 8, 8],
		G: [6, 9, 8, 11, 9, 9, 7],
		H: [9, 9, 9, 15, 9, 9, 9],
		I: [14, 4, 4, 4, 4, 4, 14],
		J: [7, 2, 2, 2, 2, 10, 4],
		K: [9, 10, 12, 8, 12, 10, 9],
		L: [8, 8, 8, 8, 8, 8, 15],
		M: [9, 15, 15, 9, 9, 9, 9],
		N: [9, 13, 13, 11, 11, 9, 9],
		O: [6, 9, 9, 9, 9, 9, 6],
		P: [14, 9, 9, 14, 8, 8, 8],
		Q: [6, 9, 9, 9, 11, 10, 7],
		R: [14, 9, 9, 14, 12, 10, 9],
		S: [6, 9, 8, 6, 1, 9, 6],
		T: [14, 4, 4, 4, 4, 4, 4],
		U: [9, 9, 9, 9, 9, 9, 6],
		V: [9, 9, 9, 9, 9, 6, 6],
		W: [9, 9, 9, 9, 15, 15, 9],
		X: [9, 9, 6, 6, 6, 9, 9],
		Y: [9, 9, 9, 6, 4, 4, 4],
		Z: [15, 1, 2, 4, 8, 8, 15],
	};
	const out: Record<string, number[]> = {};
	for (const k of Object.keys(data)) {
		out[k] = [];
		const v = data[k]!;
		for (let i = 6; i >= 0; i--) out[k]!.push((v >> i) & 1);
	}
	return out;
}

// ---- main: render an animated GIF ----
function pickWord(): string {
	const words = fs
		.readFileSync(WORDS_FILE, "utf8")
		.split("\n")
		.map((w) => w.trim())
		.filter(Boolean);
	return words[Math.floor(Math.random() * words.length)] ?? "cat";
}

export function makeGif(outPath: string, name?: string): void {
	const W = 200;
	const H = 12;
	const word = name ?? `${pickWord()} ${pickWord()}`;
	const frames: { width: number; height: number; pixels: Uint8Array; delayCs: number }[] = [];
	// 4 frames: tail sweeps left → neutral → right → neutral
	const texts = [`=^.^=  ${word}  `, `= ^_^=  ${word} `, `=^.^=  ${word}  `, `= ^_^=  ${word} `];
	for (const t of texts) {
		frames.push({
			width: W,
			height: H,
			pixels: textFrameToPixels(t, W, H),
			delayCs: 30, // 0.3s per frame
		});
	}
	const chunks: Uint8Array[] = [];
	const sink = { write: (b: Uint8Array) => chunks.push(b) };
	writeGif(frames, sink, true);
	const total = chunks.reduce((n, c) => n + c.length, 0);
	const out = new Uint8Array(total);
	let off = 0;
	for (const c of chunks) {
		out.set(c, off);
		off += c.length;
	}
	fs.writeFileSync(outPath, out);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const out = process.argv[2] ?? "cat.gif";
	makeGif(out);
	process.stdout.write(`wrote ${out} (${fs.statSync(out).size} bytes)\n`);
}
