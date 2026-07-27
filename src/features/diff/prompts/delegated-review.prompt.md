> Anchor each finding with diff-side line numbers: "additions" uses new-file lines, "deletions" uses old-file lines.
> In the JSON block, use the repo-relative path before the parentheses as each finding path.
> category is one of: "bug", "suggestion", "change", "question".
> Anchor shapes: "line" uses side + line; "range" uses side + startLine + endLine; "file" uses neither.
> Use exactly one of these finding shapes:
>
> - line: {"path":"src/example.ts","scope":"line","side":"additions","line":42,"category":"bug","text":"..."}
> - range: {"path":"src/example.ts","scope":"range","side":"additions","startLine":88,"endLine":94,"category":"change","text":"..."}
> - file: {"path":"src/example.ts","scope":"file","category":"suggestion","text":"..."}
>
> Clean response example: {"v":1,"nonce":"<echoed nonce>","reviewer":"<your name>","findings":[]}.
> Do not put "line" on a range or file finding.
> Keep this nonce for later turns. If the user later asks you to address these findings, end that later reply with VIMEFLOW_REPLY using this same nonce.
> In that later block, target each finding by its 1-based position in the findings array and include every decision you made.
> Follow-up status is one of: "reply", "clarify", "resolved", "deferred", or "rejected".
> Follow-up example (do not emit this block in the current review reply):
> <<<VIMEFLOW_REPLY
> {"v":1,"nonce":"{{NONCE}}","replies":[{"target":"finding","id":1,"status":"resolved","text":"..."}]}
> VIMEFLOW_REPLY>>>
>
> When done, end your reply with this exact block — echo the nonce verbatim and self-report the reviewer name.
> Also give a one-line overview in your normal reply (not in the block), especially if there is little to report.
> <<<VIMEFLOW_REVIEW
> {"v":1,"nonce":"{{NONCE}}","reviewer":"<your name>","findings":[{"path":"<file>","scope":"line","side":"additions","line":1,"category":"bug","text":"..."}]}
> VIMEFLOW_REVIEW>>>
