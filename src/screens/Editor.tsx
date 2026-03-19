"use client";

import { Container, SiteFooter, SiteHeader } from "@/components/SiteShell";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useState } from "react";
import {
  CompiledOutput,
  EditorSegment,
  PromptEditor,
  useCompiledText,
  Variable,
  VariablesBar,
} from "@promptfarm/prompt-editor";
import "@promptfarm/prompt-editor/styles.css";

const Editor = () => {
  const [segments, setSegments] = useState<EditorSegment[]>([]);
  const [variables, setVariables] = useState<Variable[]>([]);
  const [isRunDialogOpen, setIsRunDialogOpen] = useState(false);
  const [runOutput, setRunOutput] = useState("");

  const compiledText = useCompiledText(segments, variables);

  return (<div className="min-h-screen">
    <SiteHeader />
    <main className="pt-24">
    <section className="border-b border-border py-10">
        <Container className="max-w-4xl">
          <p className="mb-4 text-xs font-mono-app uppercase tracking-[0.24em] text-primary">Prompt editor</p>
          <h1 className="mb-6 text-4xl font-bold tracking-display md:text-6xl">
            Use real logic to produce your prompts, without leaving the editor.
          </h1>

        </Container>
      </section>
      <section className="py-16">
        <Container className="max-w-6xl overflow-hidden rounded-xl border border-[#d8dbe2] bg-[#f3f4f6] md:grid md:grid-cols-2">
          <div className="flex min-h-[720px] flex-col border-b border-[#d8dbe2] md:border-b-0 md:border-r">
            <VariablesBar
              variables={variables}
              onChange={setVariables}
              className="shrink-0 border-b border-[#d8dbe2] !bg-[#f3f4f6]"
            />
            <PromptEditor
              onChange={(_text, _blocks, segs) => setSegments(segs)}
              className="min-h-0 flex-1 !bg-[#f3f4f6]"
            />
          </div>
          <div className="min-h-[720px]">
            <CompiledOutput
              compiledPrompt={compiledText}
              onRun={(prompt) => {
                setRunOutput(prompt);
                setIsRunDialogOpen(true);
              }}
              className="h-full !bg-[#f3f4f6]"
            />
          </div>
        </Container>
      </section>
      <Dialog open={isRunDialogOpen} onOpenChange={setIsRunDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Run Output</DialogTitle>
            <DialogDescription>Compiled prompt output</DialogDescription>
          </DialogHeader>
          <pre className="max-h-[55vh] overflow-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-4 text-sm">
            {runOutput}
          </pre>
          <DialogFooter>
            <Button type="button" onClick={() => setIsRunDialogOpen(false)}>
              OK
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


    </main>
    <SiteFooter />
  </div>)
};

export default Editor;
