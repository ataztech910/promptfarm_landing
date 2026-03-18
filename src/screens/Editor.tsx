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

            <div>
                <CopyCompiledButton
                        blocks={blocks}       // PromptWorkspaceBlock[]
                         // optional — extra class on the button
                />
            <pre style={{ padding: "1.5rem", overflowY: "auto", whiteSpace: "pre-wrap" }}>
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
