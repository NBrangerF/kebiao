// What a teacher reads when a request fails: the server's own message, except where it is a browser's English
// (no HTTP status: the connection dropped) or the rate limit's technical wording.
export function errorText(error, network = '网络连接中断了，请再试一次。') {
    if (!error?.status) return network
    if (error.status === 429) return '这会儿用的人多（同一网络共用额度），请一分钟后再试。'
    return error.message || `请求失败（${error.status}）`
}
