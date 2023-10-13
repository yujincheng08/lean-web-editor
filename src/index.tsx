/// <reference types="monaco-editor" />
import { InfoRecord, LeanJsOpts, Message } from 'lean-client-js-browser';
import * as React from 'react';
import { createPortal, findDOMNode, render } from 'react-dom';
import * as sp from 'react-split-pane';
import {
    allMessages, checkInputCompletionChange, checkInputCompletionPosition, currentlyRunning, delayMs,
    registerLeanLanguage, server, tabHandler
} from './langservice';
import { watchFile } from 'fs';
export const SplitPane: any = sp;

function leanColorize(text: string): string {
    // TODO(gabriel): use promises
    const colorized: string = (monaco.editor.colorize(text, 'lean', {}) as any)._value;
    return colorized.replace(/&nbsp;/g, ' ');
}

interface MessageWidgetProps {
    msg: Message;
}
function MessageWidget({ msg }: MessageWidgetProps) {
    const colorOfSeverity = {
        information: 'green',
        warning: 'orange',
        error: 'red',
    };
    // TODO: links and decorations on hover
    return (
        <div style={{ paddingBottom: '1em' }}>
            <div className='info-header' style={{ color: colorOfSeverity[msg.severity] }}>
                {msg.pos_line}:{msg.pos_col}: {msg.severity}: {msg.caption}</div>
            <div className='code-block' dangerouslySetInnerHTML={{ __html: leanColorize(msg.text) }} />
        </div>
    );
}

interface Position {
    line: number;
    column: number;
}

interface GoalWidgetProps {
    goal: InfoRecord;
    position: Position;
}
function GoalWidget({ goal, position }: GoalWidgetProps) {
    const tacticHeader = goal.text && <div className='info-header doc-header'>
        {position.line}:{position.column}: tactic {
            <span className='code-block' style={{ fontWeight: 'normal', display: 'inline' }}>{goal.text}</span>}</div>;
    const docs = goal.doc && <ToggleDoc doc={goal.doc} />;

    const typeHeader = goal.type && <div className='info-header'>
        {position.line}:{position.column}: type {
            goal['full-id'] && <span> of <span className='code-block' style={{ fontWeight: 'normal', display: 'inline' }}>
                {goal['full-id']}</span></span>}</div>;
    const typeBody = (goal.type && !goal.text) // don't show type of tactics
        && <div className='code-block'
            dangerouslySetInnerHTML={{ __html: leanColorize(goal.type) + (!goal.doc && '<br />') }} />;

    const goalStateHeader = goal.state && <div className='info-header'>
        {position.line}:{position.column}: goal</div>;
    const goalStateBody = goal.state && <div className='code-block'
        dangerouslySetInnerHTML={{ __html: leanColorize(goal.state) + '<br/>' }} />;

    return (
        // put tactic state first so that there's less jumping around when the cursor moves
        <div>
            {goalStateHeader}
            {goalStateBody}
            {tacticHeader || typeHeader}
            {typeBody}
            {docs}
        </div>
    );
}

interface ToggleDocProps {
    doc: string;
}
interface ToggleDocState {
    showDoc: boolean;
}
class ToggleDoc extends React.Component<ToggleDocProps, ToggleDocState> {
    constructor(props: ToggleDocProps) {
        super(props);
        this.state = { showDoc: this.props.doc.length < 80 };
    }

    render() {
        return <div onClick={() => this.setState({ showDoc: !this.state.showDoc })} className='toggleDoc'>
            {this.state.showDoc ?
                this.props.doc : // TODO: markdown / highlighting?
                <span>{this.props.doc.slice(0, 75)} <span style={{ color: '#246' }}>[...]</span></span>}
            <br />
            <br />
        </div>;
    }
}

enum DisplayMode {
    OnlyState, // only the state at the current cursor position including the tactic state
    AllMessage, // all messages
}

interface InfoViewProps {
    file: string;
    cursor?: Position;
}
interface InfoViewState {
    goal?: GoalWidgetProps;
    messages: Message[];
    displayMode: DisplayMode;
}
class InfoView extends React.Component<InfoViewProps, InfoViewState> {
    private subscriptions: monaco.IDisposable[] = [];

    constructor(props: InfoViewProps) {
        super(props);
        this.state = {
            messages: [],
            displayMode: DisplayMode.OnlyState,
        };
    }
    componentWillMount() {
        this.updateMessages(this.props);
        let timer = null; // debounce
        this.subscriptions.push(
            server.allMessages.on((allMsgs) => {
                if (timer) { clearTimeout(timer); }
                timer = setTimeout(() => {
                    this.updateMessages(this.props);
                    this.refreshGoal(this.props);
                }, 100);
            }),
        );
    }
    componentWillUnmount() {
        for (const s of this.subscriptions) {
            s.dispose();
        }
        this.subscriptions = [];
    }
    componentWillReceiveProps(nextProps) {
        if (nextProps.cursor === this.props.cursor) { return; }
        this.updateMessages(nextProps);
        this.refreshGoal(nextProps);
    }

    updateMessages(nextProps) {
        this.setState({
            messages: allMessages.filter((v) => v.file_name === this.props.file),
        });
    }

    refreshGoal(nextProps?: InfoViewProps) {
        if (!nextProps) {
            nextProps = this.props;
        }
        if (!nextProps.cursor) {
            return;
        }

        const position = nextProps.cursor;
        server.info(nextProps.file, position.line, position.column).then((res) => {
            this.setState({ goal: res.record && { goal: res.record, position } });
        });
    }

    render() {
        const goal = (this.state.displayMode === DisplayMode.OnlyState) &&
            this.state.goal &&
            (<div key={'goal'}>{GoalWidget(this.state.goal)}</div>);
        const filteredMsgs = (this.state.displayMode === DisplayMode.AllMessage) ?
            this.state.messages :
            this.state.messages.filter(({ pos_col, pos_line, end_pos_col, end_pos_line }) => {
                if (!this.props.cursor) { return false; }
                const { line, column } = this.props.cursor;
                return pos_line <= line &&
                    ((!end_pos_line && line === pos_line) || line <= end_pos_line) &&
                    (line !== pos_line || pos_col <= column) &&
                    (line !== end_pos_line || end_pos_col >= column);
            });
        const msgs = filteredMsgs.map((msg, i) =>
            (<div key={i}>{MessageWidget({ msg })}</div>));
        return (
            <div style={{ overflow: 'auto', height: '100%' }}>
                <div className='infoview-buttons'>
                    <img src='./display-goal-light.svg' title='Display Goal'
                        style={{ opacity: (this.state.displayMode === DisplayMode.OnlyState ? 1 : 0.25) }}
                        onClick={() => {
                            this.setState({ displayMode: DisplayMode.OnlyState });
                        }} />
                    <img src='./display-list-light.svg' title='Display Messages'
                        style={{ opacity: (this.state.displayMode === DisplayMode.AllMessage ? 1 : 0.25) }}
                        onClick={() => {
                            this.setState({ displayMode: DisplayMode.AllMessage });
                        }} />
                </div>
                {goal}
                {msgs}
            </div>
        );
    }
}

interface PageHeaderProps {
    onFStoIS: (value: string, callback: (out: string) => void) => void;
    onIStoFS: (value: string, callback: (out: string) => void) => void;
    onIPtoFP: () => void;
    onIStoIP: (value: string) => void;
    onFStoFP: (value: string) => void;
    onFPtoIP: () => void;
    waiting: boolean;
}
interface PageHeaderState {
    is: string;
    fs: string;
}
class PageHeader extends React.Component<PageHeaderProps, PageHeaderState> {
    // private subscriptions: monaco.IDisposable[] = [];

    constructor(props: PageHeaderProps) {
        super(props);
        this.state = {
            is: 'informal statement',
            fs: 'formal statement',
        }
    }

    render() {
        return (
            <div style={{ margin: '5px' }}>
                <textarea style={{ width: '99%', height: '5em', resize: 'none' }} value={this.state.is} onChange={({ target: { value } }) => this.setState({ is: value })}>

                </textarea>
                <textarea style={{ width: '99%', height: '5em', resize: 'none' }} value={this.state.fs} onChange={({ target: { value } }) => this.setState({ fs: value })}>

                </textarea>
                <div style={{ display: 'flex', justifyContent: 'space-around' }}>
                    <button disabled={this.props.waiting} onClick={() => this.props.onIStoFS(this.state.is, (out) => this.setState({ fs: out }))}>IS-&gt;FS</button>
                    <button disabled={this.props.waiting} onClick={() => this.props.onFStoIS(this.state.fs, (out) => this.setState({ is: out }))}>FS-&gt;IS</button>
                    <button disabled={this.props.waiting} onClick={this.props.onIPtoFP}>IP-&gt;FP</button>
                    <button disabled={this.props.waiting} onClick={this.props.onFPtoIP}>FP-&gt;IP</button>
                    <button disabled={this.props.waiting} onClick={() => this.props.onIStoIP(this.state.is)}>IS-&gt;IP</button>
                    <button disabled={this.props.waiting} onClick={() => this.props.onFStoFP(this.state.fs)}>FS-&gt;FP</button>
                </div>
            </div>
        )
    }
}

interface LeanEditorProps {
    file: string;
    initialValue: string;
}
interface LeanEditorState {
    cursor?: Position;
    status: string;
    size: number;
    csize: number;
    checked: boolean;
    lastFileName: string;
    ip: string;
    waiting: boolean;
}
class LeanEditor extends React.Component<LeanEditorProps, LeanEditorState> {
    model: monaco.editor.IModel;
    editor: monaco.editor.IStandaloneCodeEditor;
    constructor(props: LeanEditorProps) {
        super(props);
        this.state = {
            status: null,
            size: null,
            csize: null,
            checked: true,
            lastFileName: this.props.file,
            ip: 'informal proof',
            waiting: false,
        };
        this.model = monaco.editor.createModel(this.props.initialValue, 'lean', monaco.Uri.file(this.props.file));
        this.model.updateOptions({ tabSize: 2 });
        this.model.onDidChangeContent((e) => {
            checkInputCompletionChange(e, this.editor, this.model);
        });
    }
    componentDidMount() {
        /* TODO: factor this out */
        const ta = document.createElement('div');
        ta.style.fontSize = '1px';
        ta.style.lineHeight = '1';
        ta.innerHTML = 'a';
        document.body.appendChild(ta);
        const minimumFontSize = ta.clientHeight;
        ta.remove();
        const node = findDOMNode(this.refs.monaco) as HTMLElement;
        const DEFAULT_FONT_SIZE = 12;
        const options: monaco.editor.IEditorConstructionOptions = {
            selectOnLineNumbers: true,
            roundedSelection: false,
            readOnly: false,
            theme: 'vs',
            cursorStyle: 'line',
            automaticLayout: true,
            cursorBlinking: 'solid',
            model: this.model,
            minimap: { enabled: false },
            wordWrap: 'on',
            scrollBeyondLastLine: false,
            fontSize: Math.max(DEFAULT_FONT_SIZE, minimumFontSize),
        };
        this.editor = monaco.editor.create(node, options);

        // context key which keeps track of whether unicode translation is possible
        const canTranslate = this.editor.createContextKey('canTranslate', false);
        this.editor.addCommand(monaco.KeyCode.Tab, () => {
            tabHandler(this.editor, this.model);
        }, 'canTranslate');
        this.editor.onDidChangeCursorPosition((e) => {
            canTranslate.set(checkInputCompletionPosition(e, this.editor, this.model));
            this.setState({ cursor: { line: e.position.lineNumber, column: e.position.column - 1 } });
        });
    }
    componentWillUnmount() {
        this.editor.dispose();
        this.editor = undefined;
    }

    apiRequest(endpoint: string, data: string, callback: (out: string) => void) {
        this.setState({ waiting: true })
        fetch(`/api/${endpoint}`, {
            method: 'POST',
            body: JSON.stringify({ data: data }),
            headers: {
                'Accept': 'application/json, text/plain',
                'Content-Type': 'application/json;charset=UTF-8'
            }
        }).then(res => res.json()).then(res => res['out']).then((res) => {
            callback(res)
        }).catch((err) => {
            callback(`-- err: ${err}`)
        }).finally(() => {
            this.setState({ waiting: false })
        })
    }


    onFStoIS = (value: string, callback: (out: string) => void) => {
        this.apiRequest('FsToIs', value, callback)
    }
    onIPtoFP = () => {
        this.apiRequest('IpToFp', this.state.ip, (out) => this.model.setValue(out))
    }
    onIStoIP = (value: string) => {
        this.apiRequest('IsToIp', value, (out) => this.setState({ ip: out }))
    }
    onFStoFP = (value: string) => {
        this.apiRequest('FsToFp', value, (out) => this.model.setValue(out))
    }
    onFPtoIP = () => {
        this.apiRequest('FpToIp', this.model.getValue(), (out) => this.setState({ ip: out }))
    }
    onIStoFS = (value: string, callback: (out: string) => void) => {
        this.apiRequest('IsToFs', value, callback)
    }

    render() {
        const infoStyle = {
            height: this.state.size ?
                `calc(99vh - ${this.state.size}px)` :
                // crude hack to set initial height if horizontal
                `calc(39vh)`,
            width: '99%',
        };
        const nlStyle = {
            height: '99%',
            width: this.state.csize ?
                `calc(99vw - ${this.state.csize}px)` :
                `calc(49vw)`,
        }
        return (<div className='leaneditorContainer'>
            <div className='headerContainer'>
                <PageHeader onFStoIS={this.onFStoIS} onFPtoIP={this.onFPtoIP} onFStoFP={this.onFStoFP} onIPtoFP={this.onIPtoFP} onIStoFS={this.onIStoFS} onIStoIP={this.onIStoIP} waiting={this.state.waiting} />
            </div>
            <div className='editorContainer' ref='root'>
                <SplitPane split={'vertical'} defaultSize='50%' allowResize={true} onDragFinished={(size) => this.setState({ csize: size })}>
                    <SplitPane split={'horizontal'} defaultSize='60%' allowResize={true}
                        onDragFinished={(size) => this.setState({ size })}>
                        <div ref='monaco' className='monacoContainer' />
                        <div className='infoContainer' style={infoStyle}>
                            <InfoView file={this.props.file} cursor={this.state.cursor} />
                        </div>
                    </SplitPane>
                    <textarea style={{ ...nlStyle, resize: 'none' }} value={this.state.ip} onChange={({ target: { value } }) => this.setState({ ip: value })}></textarea>
                </SplitPane>
            </div>
        </div>);
    }
}

const defaultValue = `-- formal proof`;

function App() {
    const fn = monaco.Uri.file('test.lean').fsPath;

    if (window.localStorage.getItem('underline') === 'true') {
        const style = document.createElement('style');
        style.type = 'text/css';
        style.id = 'hideUnderline';
        style.appendChild(document.createTextNode(`.monaco-editor .greensquiggly,
    .monaco-editor .redsquiggly { background-size:0px; }`));
        document.head.appendChild(style);
    }

    if (window.localStorage.getItem('docs') === 'true') {
        const style = document.createElement('style');
        style.type = 'text/css';
        style.id = 'hideDocs';
        style.appendChild(document.createTextNode(`.toggleDoc, .doc-header { display:none; }`));
        document.head.appendChild(style);
    }

    return (
        <LeanEditor file={fn} initialValue={defaultValue} />
    );
}

const hostPrefix = './';

const leanJsOpts: LeanJsOpts = {
    javascript: hostPrefix + 'lean_js_js.js',
    libraryZip: hostPrefix + 'library.zip',
    libraryMeta: hostPrefix + 'library.info.json',
    libraryOleanMap: hostPrefix + 'library.olean_map.json',
    libraryKey: 'library',
    webassemblyJs: hostPrefix + 'lean_js_wasm.js',
    webassemblyWasm: hostPrefix + 'lean_js_wasm.wasm',
    dbName: 'leanlibrary',
};

let info = null;
const metaPromise = fetch(leanJsOpts.libraryMeta)
    .then((res) => res.json())
    .then((j) => info = j);

// tslint:disable-next-line:no-var-requires
(window as any).require(['vs/editor/editor.main'], () => {
    registerLeanLanguage(leanJsOpts);
    render(
        <App />,
        document.getElementById('root'),
    );
});
