"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

const SCALE = 1.5;

type Annotation = {
  id: string;
  pageIndex: number;
  x: number;
  y: number;
  text: string;
  fontSize: number; // CSS px on screen; saved as fontSize/SCALE pts in PDF
  color: string;
};

type PdfText = {
  id: string;
  pageIndex: number;
  x: number;
  y: number;
  w: number;
  h: number; // canvas pixels
  original: string;
  replacement: string | null;
};

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  ];
}

export default function PdfEditor() {
  const [file, setFile] = useState<File | null>(null);
  const [rawBytes, setRawBytes] = useState<Uint8Array | null>(null);
  const [pdfjsDoc, setPdfjsDoc] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [page, setPage] = useState(0);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [pdfTexts, setPdfTexts] = useState<PdfText[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tool, setTool] = useState<"select" | "addText">("select");
  const [fontSize, setFontSize] = useState(24);
  const [color, setColor] = useState("#000000");
  const [saving, setSaving] = useState(false);
  const [dropping, setDropping] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; mx: number; my: number; ox: number; oy: number } | null>(null);

  const loadFile = useCallback(async (f: File) => {
    if (f.type !== "application/pdf") return;
    setFile(f);
    const bytes = new Uint8Array(await f.arrayBuffer());
    setRawBytes(bytes);
    const doc = await pdfjs.getDocument({ data: bytes }).promise;
    setPdfjsDoc(doc);
    setPageCount(doc.numPages);
    setPage(0);
    setAnnotations([]);
    setPdfTexts([]);
    setSelectedId(null);
    setEditingId(null);
  }, []);

  // Render page + extract text items
  useEffect(() => {
    if (!pdfjsDoc) return;
    let cancelled = false;

    (async () => {
      const p = await pdfjsDoc.getPage(page + 1);
      const vp = p.getViewport({ scale: SCALE });
      if (cancelled) return;

      const canvas = canvasRef.current!;
      canvas.width = vp.width;
      canvas.height = vp.height;

      await p.render({ canvasContext: canvas.getContext("2d")!, viewport: vp, canvas }).promise;
      if (cancelled) return;

      const tc = await p.getTextContent();
      const items: PdfText[] = (tc.items as any[])
        .filter(it => it.str?.trim())
        .map((it, i) => {
          const [, , , scaleY, tx, ty] = it.transform as number[];
          const [vpX, vpY] = vp.convertToViewportPoint(tx, ty);
          const h = Math.abs(scaleY) * SCALE;
          const w = Math.max((it.width ?? 0) * SCALE || it.str.length * h * 0.55, 10);
          return {
            id: `pt-${page}-${i}`,
            pageIndex: page,
            x: vpX,
            y: vpY - h,
            w,
            h,
            original: it.str,
            replacement: null,
          };
        });

      if (!cancelled) {
        setPdfTexts(prev => [...prev.filter(t => t.pageIndex !== page), ...items]);
      }
    })();

    return () => { cancelled = true; };
  }, [pdfjsDoc, page]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key === "Escape") { setSelectedId(null); setEditingId(null); setTool("select"); }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        setAnnotations(prev => prev.filter(a => a.id !== selectedId));
        setSelectedId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId]);

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (tool !== "addText" || drag.current) return;
    const rect = overlayRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const id = crypto.randomUUID();
    setAnnotations(prev => [...prev, { id, pageIndex: page, x, y, text: "", fontSize, color }]);
    setSelectedId(id);
    setEditingId(id);
    setTool("select");
  };

  const startDrag = (e: React.MouseEvent, id: string, ox: number, oy: number) => {
    e.preventDefault();
    e.stopPropagation();
    drag.current = { id, mx: e.clientX, my: e.clientY, ox, oy };
    setSelectedId(id);
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!drag.current) return;
    const { id, mx, my, ox, oy } = drag.current;
    setAnnotations(prev =>
      prev.map(a => a.id === id ? { ...a, x: ox + e.clientX - mx, y: oy + e.clientY - my } : a)
    );
  };

  const savePdf = async () => {
    if (!rawBytes || !pdfjsDoc) return;
    setSaving(true);
    try {
      const doc = await PDFDocument.load(rawBytes);
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const pdfPages = doc.getPages();

      for (let pi = 0; pi < pdfPages.length; pi++) {
        const pp = pdfPages[pi];
        const pdfH = pp.getSize().height;

        // White-out + redraw edited existing text
        for (const t of pdfTexts.filter(t => t.pageIndex === pi && t.replacement !== null)) {
          const x = t.x / SCALE;
          const y = pdfH - (t.y + t.h) / SCALE;
          const w = t.w / SCALE;
          const h = t.h / SCALE;
          pp.drawRectangle({ x: x - 1, y: y - 1, width: w + 4, height: h + 2, color: rgb(1, 1, 1) });
          pp.drawText(t.replacement!, { x, y: y + 1, size: h * 0.85, font, color: rgb(0, 0, 0) });
        }

        // New text annotations
        for (const a of annotations.filter(a => a.pageIndex === pi && a.text.trim())) {
          const x = a.x / SCALE;
          const y = pdfH - (a.y + a.fontSize) / SCALE;
          const [r, g, b] = hexToRgb(a.color);
          pp.drawText(a.text, { x, y, size: a.fontSize / SCALE, font, color: rgb(r, g, b) });
        }
      }

      const out = await doc.save();
      // slice the buffer to exact bounds — out.buffer may have excess capacity
      const blob = new Blob([(out.buffer as ArrayBuffer).slice(out.byteOffset, out.byteOffset + out.byteLength)], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file!.name.replace(/\.pdf$/i, "-edited.pdf");
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      console.error("Save failed:", err);
      alert("Failed to save PDF: " + String(err));
    } finally {
      setSaving(false);
    }
  };

  const curAnnotations = annotations.filter(a => a.pageIndex === page);
  const curTexts = pdfTexts.filter(t => t.pageIndex === page);

  // ── Upload screen ──────────────────────────────────────────────
  if (!file) {
    return (
      <div
        className={`w-full rounded-2xl border-2 border-dashed transition-colors p-16 flex flex-col items-center gap-4 cursor-pointer ${
          dropping ? "border-blue-500 bg-blue-50" : "border-gray-300 bg-gray-50 hover:border-gray-400 hover:bg-gray-100"
        }`}
        onDrop={e => { e.preventDefault(); setDropping(false); const f = e.dataTransfer.files[0]; if (f) loadFile(f); }}
        onDragOver={e => { e.preventDefault(); setDropping(true); }}
        onDragLeave={() => setDropping(false)}
        onClick={() => document.getElementById("pdf-upload")?.click()}
      >
        <svg className="w-12 h-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <div className="text-center">
          <p className="text-sm font-semibold text-gray-700">Drop a PDF or click to upload</p>
          <p className="text-xs text-gray-400 mt-1">Edit existing text or add new text anywhere on the page</p>
        </div>
        <input
          id="pdf-upload"
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) loadFile(f); }}
        />
      </div>
    );
  }

  // ── Editor screen ──────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-3 w-full">

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap bg-white border border-gray-200 rounded-xl px-4 py-2.5 shadow-sm">
        <button
          onClick={() => setTool("select")}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            tool === "select" ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100"
          }`}
        >
          ↖ Select
        </button>
        <button
          onClick={() => setTool("addText")}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            tool === "addText" ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-100"
          }`}
        >
          T+ Add Text
        </button>

        <div className="w-px h-5 bg-gray-200 mx-1" />

        <span className="text-xs text-gray-500 font-medium">Size</span>
        <input
          type="number"
          value={fontSize}
          min={6} max={144}
          onChange={e => {
            const v = Number(e.target.value);
            setFontSize(v);
            if (selectedId) setAnnotations(prev => prev.map(a => a.id === selectedId ? { ...a, fontSize: v } : a));
          }}
          className="w-16 text-sm border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        <span className="text-xs text-gray-500 font-medium">Color</span>
        <input
          type="color"
          value={color}
          onChange={e => {
            setColor(e.target.value);
            if (selectedId) setAnnotations(prev => prev.map(a => a.id === selectedId ? { ...a, color: e.target.value } : a));
          }}
          className="w-8 h-8 rounded cursor-pointer border border-gray-200"
        />

        {selectedId && annotations.some(a => a.id === selectedId) && (
          <>
            <div className="w-px h-5 bg-gray-200 mx-1" />
            <button
              onClick={() => { setAnnotations(prev => prev.filter(a => a.id !== selectedId)); setSelectedId(null); }}
              className="px-3 py-1.5 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
            >
              Delete
            </button>
          </>
        )}

        <div className="flex-1" />

        <button
          onClick={savePdf}
          disabled={saving}
          className="px-4 py-1.5 rounded-lg text-sm font-semibold bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
        >
          {saving ? "Saving..." : "↓ Save PDF"}
        </button>
        <button
          onClick={() => { setFile(null); setPdfjsDoc(null); setRawBytes(null); setAnnotations([]); setPdfTexts([]); }}
          className="px-3 py-1.5 rounded-lg text-sm font-medium text-gray-500 hover:bg-gray-100 transition-colors"
        >
          ✕ Close
        </button>
      </div>

      {/* Page navigation */}
      <div className="flex items-center justify-center gap-4 text-sm">
        <button
          onClick={() => setPage(p => Math.max(0, p - 1))}
          disabled={page === 0}
          className="px-3 py-1 rounded-lg hover:bg-gray-100 disabled:opacity-30 transition-colors font-medium"
        >
          ← Prev
        </button>
        <span className="text-gray-600 min-w-[80px] text-center">{page + 1} / {pageCount}</span>
        <button
          onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}
          disabled={page === pageCount - 1}
          className="px-3 py-1 rounded-lg hover:bg-gray-100 disabled:opacity-30 transition-colors font-medium"
        >
          Next →
        </button>
      </div>

      {/* Canvas + overlay */}
      <div className="flex justify-center overflow-auto">
        <div
          className="relative inline-block shadow-xl rounded-lg overflow-hidden border border-gray-200 select-none"
          onMouseMove={onMouseMove}
          onMouseUp={() => { drag.current = null; }}
          onMouseLeave={() => { drag.current = null; }}
        >
          <canvas ref={canvasRef} />

          <div
            ref={overlayRef}
            className="absolute inset-0"
            style={{ cursor: tool === "addText" ? "text" : "default" }}
            onClick={handleOverlayClick}
          >
            {/* Existing PDF text — hover to see outline, double-click to edit */}
            {curTexts.map(t => (
              <div
                key={t.id}
                style={{ position: "absolute", left: t.x, top: t.y, width: t.w, height: t.h, minWidth: 8 }}
                className={`cursor-text ${
                  t.replacement !== null
                    ? "ring-1 ring-blue-400 rounded"
                    : ""
                }`}
                onClick={e => e.stopPropagation()}
                onDoubleClick={e => {
                  e.stopPropagation();
                  setPdfTexts(prev =>
                    prev.map(x => x.id === t.id ? { ...x, replacement: x.replacement ?? x.original } : x)
                  );
                  setEditingId(t.id);
                  setSelectedId(t.id);
                }}
              >
                {t.replacement !== null && (
                  <input
                    autoFocus={editingId === t.id}
                    value={t.replacement}
                    onChange={e =>
                      setPdfTexts(prev => prev.map(x => x.id === t.id ? { ...x, replacement: e.target.value } : x))
                    }
                    onBlur={() => setEditingId(prev => prev === t.id ? null : prev)}
                    onClick={e => e.stopPropagation()}
                    className="w-full h-full border-none outline-none p-0 m-0"
                    style={{ fontSize: t.h * 0.85, lineHeight: 1, color: "#000", backgroundColor: "#fff" }}
                  />
                )}
              </div>
            ))}

            {/* New text annotations */}
            {curAnnotations.map(ann => (
              <div
                key={ann.id}
                style={{ position: "absolute", left: ann.x, top: ann.y }}
                className={`rounded cursor-move ${selectedId === ann.id ? "ring-1 ring-blue-500" : ""}`}
                onMouseDown={e => { if (editingId !== ann.id) startDrag(e, ann.id, ann.x, ann.y); }}
                onClick={e => { e.stopPropagation(); setSelectedId(ann.id); }}
                onDoubleClick={e => { e.stopPropagation(); setEditingId(ann.id); setSelectedId(ann.id); }}
              >
                {editingId === ann.id ? (
                  <input
                    autoFocus
                    value={ann.text}
                    onChange={e => setAnnotations(prev => prev.map(a => a.id === ann.id ? { ...a, text: e.target.value } : a))}
                    onBlur={() => setEditingId(prev => prev === ann.id ? null : prev)}
                    onClick={e => e.stopPropagation()}
                    className="bg-white/90 border-none outline-none px-1 rounded"
                    style={{ fontSize: ann.fontSize, color: ann.color, minWidth: 80, caretColor: ann.color }}
                  />
                ) : (
                  <div
                    className="px-1 whitespace-nowrap"
                    style={{ fontSize: ann.fontSize, color: ann.color, lineHeight: 1.2 }}
                  >
                    {ann.text || <span className="text-gray-300 text-sm italic">double-click to type</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <p className="text-xs text-center text-gray-400">
        {tool === "addText"
          ? "Click anywhere on the page to place a text box"
          : "Double-click existing PDF text to edit it · Double-click your text box to type · Drag to move · Delete key removes selected"}
      </p>
    </div>
  );
}
