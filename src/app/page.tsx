import PdfViewerWrapper from "@/components/PdfViewerWrapper";

export default function Home() {
  return (
    <main className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-2xl font-semibold text-gray-800 mb-8 text-center">
          PDF Editor
        </h1>
        <PdfViewerWrapper />
      </div>
    </main>
  );
}
