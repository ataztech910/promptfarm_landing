import { Container, SiteFooter, SiteHeader, CHANGELOG_URL, REPO_URL } from "@/components/SiteShell";
import { useState } from "react";
import {
  PromptBlockEditor,
  usePromptCompiler,
  createPromptWorkspaceBlock,
  CopyCompiledButton,
} from "@promptfarm/prompt-editor";
import "@promptfarm/prompt-editor/styles.css";


const Editor = () => {
  const [blocks, setBlocks] = useState(() => [
    createPromptWorkspaceBlock("prompt"),
  ]);
  const compiled = usePromptCompiler(blocks);

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
        
        <Container className="grid gap-6 md:grid-cols-2">
           
          {/* <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", height: "100vh" }}> */}
            <PromptBlockEditor blocks={blocks} onChange={setBlocks} 
                genericRoleOptions={[  // optional — custom roles for the generic block dropdown
                    { name: "analyst",  description: "You are an analyst, your job is to analyze data" },
                    { name: "reviewer", description: "You are a code reviewer focused on quality" },
                    { name: "editor",   description: "You are an editor improving clarity and tone" },
                ]}
            />

            <div className="rounded-2xl border border-border bg-card p-6 transition-colors hover:border-primary/4 relative">
                <div className="absolute top-2 right-2 ">
                        <CopyCompiledButton blocks={blocks} />
                </div>
            <pre className="mt-4 whitespace-pre-wrap break-words">
                {compiled.text || "← Start writing on the left"}
            </pre>
            </div>
            {/* </div> */}
        </Container>
      </section>

      
    </main>
    <SiteFooter />
  </div>)
};

export default Editor;
