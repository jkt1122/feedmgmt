"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { trpc } from "@/lib/trpc/client";
import { CANONICAL_FIELDS, suggestMapping } from "@/lib/canonical-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Upload, FileText, ArrowRight, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import Papa from "papaparse";

type Step = "upload" | "mapping" | "done";

export default function NewSourcePage() {
  const router = useRouter();
  const supabase = createClient();
  const createSource = trpc.dataSource.create.useMutation();
  const updateMapping = trpc.dataSource.updateMapping.useMutation();
  const runPipeline = trpc.dataSource.runPipeline.useMutation();

  const [step, setStep] = useState<Step>("upload");
  const [sourceName, setSourceName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [preview, setPreview] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);

  const handleFileDrop = useCallback((f: File) => {
    setFile(f);
    if (!sourceName) setSourceName(f.name.replace(/\.csv$/i, ""));

    Papa.parse(f, {
      header: true,
      preview: 5,
      skipEmptyLines: true,
      complete: (results) => {
        const cols = results.meta.fields ?? [];
        setHeaders(cols);
        setPreview(results.data as Record<string, string>[]);
        setMapping(suggestMapping(cols));
      },
    });
  }, [sourceName]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f?.name.endsWith(".csv")) handleFileDrop(f);
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const storagePath = `${user.id}/${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from("feeds")
        .upload(storagePath, file);

      if (uploadError) throw new Error(uploadError.message);

      const source = await createSource.mutateAsync({
        name: sourceName || file.name,
        originalFilename: file.name,
        storagePath,
        columnMapping: mapping,
      });

      setCreatedId(source.id);
      setStep("mapping");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleSaveMapping = async () => {
    if (!createdId) return;
    await updateMapping.mutateAsync({ id: createdId, columnMapping: mapping });
    await runPipeline.mutateAsync({ id: createdId });
    setStep("done");
    setTimeout(() => router.push(`/sources/${createdId}`), 800);
  };

  if (step === "done") {
    return (
      <div className="flex flex-col items-center justify-center h-full">
        <CheckCircle2 className="w-10 h-10 text-green-500 mb-3" />
        <p className="text-base font-semibold text-ink">Source created!</p>
        <p className="text-sm text-slate">Redirecting to your data…</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      {/* Stepper */}
      <div className="flex items-center gap-2 mb-8 text-sm">
        <StepBadge n={1} active={step === "upload"} done={step !== "upload"} label="Upload" />
        <div className="flex-1 h-px bg-border" />
        <StepBadge n={2} active={step === "mapping"} done={false} label="Map fields" />
      </div>

      {step === "upload" && (
        <div className="space-y-6">
          <div>
            <h1 className="text-xl font-bold text-ink mb-1">Add data source</h1>
            <p className="text-sm text-slate">Upload a product catalog CSV to get started.</p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm font-semibold text-ink">Source name</Label>
            <Input
              value={sourceName}
              onChange={(e) => setSourceName(e.target.value)}
              placeholder="e.g. Main catalog, Summer collection"
            />
          </div>

          <div
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            className={cn(
              "border-2 border-dashed rounded-lg p-10 text-center transition-colors",
              file ? "border-electric bg-lavender/30" : "border-border hover:border-electric hover:bg-mist"
            )}
          >
            {file ? (
              <div className="flex flex-col items-center gap-2">
                <FileText className="w-8 h-8 text-electric" />
                <p className="text-sm font-semibold text-ink">{file.name}</p>
                <p className="text-xs text-slate">{(file.size / 1024).toFixed(1)} KB</p>
                <button
                  onClick={() => { setFile(null); setHeaders([]); }}
                  className="text-xs text-slate hover:text-ink underline"
                >
                  Remove
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <Upload className="w-8 h-8 text-slate" />
                <div>
                  <p className="text-sm font-semibold text-ink">Drop your CSV here</p>
                  <p className="text-xs text-slate mt-1">or click to browse</p>
                </div>
                <input
                  type="file"
                  accept=".csv"
                  className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFileDrop(f);
                  }}
                />
              </div>
            )}
          </div>

          {file && headers.length > 0 && (
            <div className="bg-surface-2 rounded-lg p-3">
              <p className="text-xs font-semibold text-slate mb-1">
                {headers.length} columns detected
              </p>
              <p className="text-xs text-slate truncate">{headers.join(", ")}</p>
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          <Button
            onClick={handleUpload}
            disabled={!file || !sourceName || uploading}
            className="w-full bg-electric hover:bg-accent-hover text-white font-semibold"
          >
            {uploading ? "Uploading…" : "Continue"}
            {!uploading && <ArrowRight className="w-4 h-4 ml-2" />}
          </Button>
        </div>
      )}

      {step === "mapping" && (
        <div className="space-y-6">
          <div>
            <h1 className="text-xl font-bold text-ink mb-1">Map your columns</h1>
            <p className="text-sm text-slate">
              Match your CSV columns to canonical fields. We&apos;ve auto-detected likely matches.
            </p>
          </div>

          <div className="space-y-3">
            {CANONICAL_FIELDS.filter((f) => f.required).map((field) => (
              <MappingRow
                key={field.key}
                field={field}
                headers={headers}
                preview={preview}
                value={mapping[field.key] ?? ""}
                onChange={(v) => setMapping((m) => ({ ...m, [field.key]: v ?? "" }))}
              />
            ))}
          </div>

          <details className="group">
            <summary className="text-sm font-semibold text-slate cursor-pointer hover:text-ink">
              Optional fields ({CANONICAL_FIELDS.filter((f) => !f.required).length})
            </summary>
            <div className="mt-3 space-y-3">
              {CANONICAL_FIELDS.filter((f) => !f.required).map((field) => (
                <MappingRow
                  key={field.key}
                  field={field}
                  headers={headers}
                  preview={preview}
                  value={mapping[field.key] ?? ""}
                  onChange={(v) => setMapping((m) => ({ ...m, [field.key]: v ?? "" }))}
                />
              ))}
            </div>
          </details>

          <Button
            onClick={handleSaveMapping}
            disabled={updateMapping.isPending || runPipeline.isPending}
            className="w-full bg-electric hover:bg-accent-hover text-white font-semibold"
          >
            {runPipeline.isPending ? "Importing products…" : updateMapping.isPending ? "Saving…" : "Save mapping & import"}
            {!updateMapping.isPending && !runPipeline.isPending && <ArrowRight className="w-4 h-4 ml-2" />}
          </Button>
        </div>
      )}
    </div>
  );
}

function MappingRow({
  field,
  headers,
  preview,
  value,
  onChange,
}: {
  field: (typeof CANONICAL_FIELDS)[number];
  headers: string[];
  preview: Record<string, string>[];
  value: string;
  onChange: (v: string | null) => void;
}) {
  const sampleValue = value && preview[0] ? preview[0][value] : null;

  return (
    <div className="grid grid-cols-[1fr_1fr] gap-3 items-start">
      <div>
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-semibold text-ink">{field.label}</span>
          {field.required && (
            <span className="text-xs font-semibold text-red-500">*</span>
          )}
        </div>
        <p className="text-xs text-slate mt-0.5">{field.description}</p>
      </div>
      <div>
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger className="text-sm">
            <SelectValue placeholder="— not mapped —" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">— not mapped —</SelectItem>
            {headers.map((h) => (
              <SelectItem key={h} value={h}>
                {h}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {sampleValue && (
          <p className="text-xs font-data text-slate mt-1 truncate" title={sampleValue}>
            e.g. {sampleValue}
          </p>
        )}
      </div>
    </div>
  );
}

function StepBadge({
  n,
  active,
  done,
  label,
}: {
  n: number;
  active: boolean;
  done: boolean;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <div
        className={cn(
          "w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold",
          active
            ? "bg-electric text-white"
            : done
            ? "bg-green-500 text-white"
            : "bg-surface-2 text-slate"
        )}
      >
        {done ? "✓" : n}
      </div>
      <span
        className={cn(
          "text-sm font-medium",
          active ? "text-ink" : "text-slate"
        )}
      >
        {label}
      </span>
    </div>
  );
}
