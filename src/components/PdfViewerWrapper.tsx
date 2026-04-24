"use client";

import dynamic from "next/dynamic";

const PdfEditor = dynamic(() => import("./PdfEditor"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-40 text-gray-400 text-sm">
      Loading editor...
    </div>
  ),
});

export default function PdfViewerWrapper() {
  return <PdfEditor />;
}
