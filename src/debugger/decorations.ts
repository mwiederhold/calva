import * as vscode from 'vscode';
import * as util from '../utilities';
import * as docMirror from '../doc-mirror';
import { NReplSession } from '../nrepl';
const { parseEdn } = require('../../out/cljs-lib/cljs-lib');

const instrumentedFunctionDecorationType = vscode.window.createTextEditorDecorationType({
    borderWidth: '1px',
    borderStyle: 'solid',
    overviewRulerColor: 'blue',
    overviewRulerLane: vscode.OverviewRulerLane.Right,
    light: {
        // This color will be used in light color themes
        borderColor: 'darkblue'
    },
    dark: {
        // This color will be used in dark color themes
        borderColor: 'lightblue'
    }
});

async function getLintAnalysis(session: NReplSession, filePath: string): Promise<any> {
    let resEdn: string;
    resEdn = await session.eval(`(do (require 'clj-kondo.core) (:analysis (clj-kondo.core/run! {:lint ["${filePath}"] :config {:output {:analysis true}}})))`, 'user').value;
    return parseEdn(resEdn);
}

function getVarDefinitionRanges(definitions: any[], document: vscode.TextDocument): [number, number][] {
    const mirroredDocument = docMirror.getDocument(document);
    return definitions.map(varInfo => {
        const position = new vscode.Position(varInfo.row - 1, varInfo.col - 1);
        const offset = document.offsetAt(position);
        const tokenCursor = mirroredDocument.getTokenCursor(offset);
        while (tokenCursor.getToken().raw !== varInfo.name && !tokenCursor.atEnd()) {
            tokenCursor.next();
        }
        return [tokenCursor.offsetStart, tokenCursor.offsetEnd];
    });
}

function getVarUsageRanges(usages: any[], document: vscode.TextDocument): [number, number][] {
    const mirroredDocument = docMirror.getDocument(document);
    return usages.map(varInfo => {
        const position = new vscode.Position(varInfo.row - 1, varInfo.col - 1);
        const offset = document.offsetAt(position);
        const tokenCursor = mirroredDocument.getTokenCursor(offset);
        return [offset, tokenCursor.offsetEnd];
    });
}

async function updateDecorations() {
    const activeEditor = vscode.window.activeTextEditor;

    if (activeEditor && /(\.cljc?)$/.test(activeEditor.document.fileName)) {
        const cljSession = util.getSession('clj');

        if (cljSession) {
            const document = activeEditor.document;

            // Get instrumented defs in current editor
            const docNamespace = util.getDocumentNamespace(document);
            const instrumentedDefs = await cljSession.listDebugInstrumentedDefs();
            const instrumentedDefsInEditor = instrumentedDefs.list.filter(alist => alist[0] === docNamespace)[0]?.slice(1) || [];

            // Get editor ranges of instrumented var definitions and usages
            const lintAnalysis = await getLintAnalysis(cljSession, document.uri.path);
            const instrumentedVarDefs = lintAnalysis['var-definitions'].filter(varInfo => instrumentedDefsInEditor.includes(varInfo.name));
            const instrumentedVarDefRanges = getVarDefinitionRanges(instrumentedVarDefs, document);
            const instrumentedVarUsages = lintAnalysis['var-usages'].filter(varInfo => {
                const instrumentedDefsInVarNs = instrumentedDefs.list.filter(l => l[0] === varInfo.to)[0]?.slice(1) || [];
                return instrumentedDefsInVarNs.includes(varInfo.name);
            });
            const instrumentedVarUsageRanges = getVarUsageRanges(instrumentedVarUsages, document);

            const decorations = [...instrumentedVarDefRanges, ...instrumentedVarUsageRanges].map(([startOffset, endOffset]) => {
                return {
                    range: new vscode.Range(document.positionAt(startOffset), document.positionAt(endOffset)),
                    hoverMessage: 'Instrumented for debugging'
                };
            });
            activeEditor.setDecorations(instrumentedFunctionDecorationType, decorations);
        } else {
            activeEditor.setDecorations(instrumentedFunctionDecorationType, []);
        }
    }
}

let timeout: NodeJS.Timer | undefined = undefined;

function triggerUpdateDecorations() {
    if (timeout) {
        clearTimeout(timeout);
        timeout = undefined;
    }
    timeout = setTimeout(updateDecorations, 50);
}

function activate() {

    triggerUpdateDecorations();

    vscode.window.onDidChangeActiveTextEditor(triggerUpdateDecorations);

    vscode.workspace.onDidSaveTextDocument(document => {
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor && document === activeEditor.document) {
            triggerUpdateDecorations();
        }
    });
}

export default {
    activate,
    triggerUpdateDecorations
};