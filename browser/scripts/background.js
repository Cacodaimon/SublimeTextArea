function inCurrentTab(callback) {
	chrome.tabs.query({
		active: true,
		currentWindow: true
	}, tabs => callback(tabs[0]));
}

function handleClose(info, tab) {
	chrome.tabs.executeScript(tab.id, {
		code: 'stopGT()'
	});
}

async function handleAction({id}) {
	const defaults = {
		runAt: 'document_start',
		allFrames: true
	};
	const [alreadyInjected] = await browser.tabs.executeScript(id, {
		...defaults,
		code: 'typeof window.startGT === "function"'
	});
	console.log(alreadyInjected);
	if (alreadyInjected) {
		return browser.tabs.executeScript(id, {...defaults, code: 'startGT()'});
	}

	try {
		await Promise.all([
			browser.tabs.insertCSS(id, {...defaults, file: '/scripts/content.css'}),
			browser.tabs.insertCSS(id, {...defaults, file: '/vendor/humane-ghosttext.css'}),
			browser.tabs.executeScript(id, {...defaults, file: '/vendor/humane-ghosttext.js'}),
			browser.tabs.executeScript(id, {...defaults, file: '/vendor/one-event.browser.js'}),
			browser.tabs.executeScript(id, {...defaults, file: '/scripts/unsafe-messenger.js'}),
			browser.tabs.executeScript(id, {...defaults, file: '/scripts/content.js'})
		]);
	} catch (error) {
		console.error(error);
	}

	await browser.tabs.executeScript(id, {...defaults, code: 'startGT()'});
}

function handlePortListenerErrors(listener) {
	return async port => {
		try {
			await listener(port);
		} catch (error) {
			let {message} = error;
			if (message === 'Failed to fetch') {
				message = 'Unable to connect to the editor. Make sure it’s open, the GhostText extension is running in it, and that the port matches (if you changed it)';
			}

			port.postMessage({error: message});
		}
	};
}

chrome.runtime.onConnect.addListener(handlePortListenerErrors(async port => {
	console.assert(port.name === 'new-field');
	// TODO: read port from config
	const response = await fetch('http://localhost:4001');
	const {ProtocolVersion, WebSocketPort} = await response.json();
	if (ProtocolVersion !== 1) {
		throw new Error('Incompatible protocol version');
	}

	console.log('will open socket');
	const socket = new WebSocket('ws://localhost:' + WebSocketPort);
	const event = await Promise.race([
		oneEvent.promise(socket, 'open'),
		oneEvent.promise(socket, 'error')
	]);
	console.log(event);

	const onSocketClose = () => port.postMessage({close: true});
	socket.addEventListener('close', onSocketClose);
	socket.addEventListener('message', event => port.postMessage({message: event.data}));
	socket.addEventListener('error', event => console.error('error!', event));

	port.onMessage.addListener(message => {
		console.log('got message from script', message);
		socket.send(message);
	});
	console.log(port);
	port.onDisconnect.addListener(() => {
		socket.removeEventListener('close', onSocketClose);
		socket.close();
	});
	port.postMessage({ready: true});
}));

function handleMessages({code, count}, {tab}) {
	if (code === 'connection-count') {
		let text = '';
		if (count === 1) {
			text = /os x/i.test(navigator.userAgent) ? '✓' : 'ON';
		} else if (count > 1) {
			text = String(count);
		}

		chrome.browserAction.setBadgeText({
			text,
			tabId: tab.id
		});
	}
}

function init() {
	chrome.browserAction.onClicked.addListener(handleAction);
	chrome.runtime.onMessage.addListener(handleMessages);
	chrome.contextMenus.create({
		id: 'stop-gt',
		title: 'Disconnect GhostText on this page',
		contexts: ['browser_action'],
		onclick: handleClose
	});
	chrome.commands.onCommand.addListener(command => {
		if (command === 'open') {
			inCurrentTab(handleAction);
		}
	});

	chrome.browserAction.setBadgeBackgroundColor({
		color: '#008040'
	});

	/* globals OptionsSync */
	new OptionsSync().define({
		defaults: {
			serverPort: 4001
		}
	});
}

init();
