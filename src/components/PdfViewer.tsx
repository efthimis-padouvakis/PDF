"use client";

import { useCallback, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

export default function PdfViewer() {
  const [file, setFile] = useState<File | null>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [isDragging, setIsDragging] = useState(false);

  const handleFile = (f: File) => {
    if (f.type !== "application/pdf") return;
    setFile(f);
    setCurrentPage(1);
    setNumPages(0);
  };

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) handleFile(dropped);
  }, []);

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) handleFile(selected);
  };

  return (
    <div className="flex flex-col items-center gap-6 w-full max-w-3xl mx-auto p-6">
      {/* Upload area */}
      <div
        onDrop={onDrop}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        className={`w-full rounded-2xl border-2 border-dashed transition-colors p-10 flex flex-col items-center gap-3 cursor-pointer
          ${isDragging
            ? "border-blue-500 bg-blue-50"
            : "border-gray-300 bg-gray-50 hover:border-gray-400 hover:bg-gray-100"
          }`}
        onClick={() => document.getElementById("pdf-input")?.click()}
      >
        <svg className="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <p className="text-sm text-gray-600 font-medium">
          {file ? file.name : "Drop PDF here or click to upload"}
        </p>
        <input
          id="pdf-input"
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={onInputChange}
        />
      </div>

      {/* PDF Viewer */}
      {file && (
        <div className="w-full flex flex-col items-center gap-4">
          {/* Page controls */}
          <div className="flex items-center gap-4 bg-white border border-gray-200 rounded-xl px-4 py-2 shadow-sm">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
              className="px-3 py-1 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              ← Prev
            </button>
            <span className="text-sm text-gray-600 min-w-[80px] text-center">
              {currentPage} / {numPages || "—"}
            </span>
            <button
              onClick={() => setCurrentPage((p) => Math.min(numPages, p + 1))}
              disabled={currentPage >= numPages}
              className="px-3 py-1 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Next →
            </button>
          </div>

          {/* Document */}
          <div className="rounded-xl overflow-hidden shadow-lg border border-gray-200">
            <Document
              file={file}
              onLoadSuccess={({ numPages }) => setNumPages(numPages)}
              loading={
                <div className="flex items-center justify-center w-[640px] h-[400px] bg-gray-50 text-gray-400 text-sm">
                  Loading PDF...
                </div>
              }
              error={
                <div className="flex items-center justify-center w-[640px] h-[200px] bg-red-50 text-red-400 text-sm">
                  Failed to load PDF.
                </div>
              }
            >
              <Page
                pageNumber={currentPage}
                width={640}
                renderTextLayer
                renderAnnotationLayer
              />
            </Document>
          </div>
        </div>
      )}
    </div>
  );
}
