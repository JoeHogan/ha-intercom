let tokenObj = null;
let isRefreshing = null;

const getTokenFromHassConnection = () => {
    let hassConnection = window.hassConnection || window.parent.hassConnection;
    if(hassConnection) {
        return hassConnection.then((config) => {
            if(config?.auth?.data){
                tokenObj = config.auth.data; // set tokenObj
                return tokenObj;
            }
            return {};
        })
        .catch((err) => {
            console.log(`error getting access token from HASS Connection: ${err}`);
            return {};
        })
    }
    return Promise.resolve({});
}

const refreshWebToken = (data) => {
    let body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: data.refresh_token,
        client_id: data.clientId
    });

    return fetch(`/auth/token`, {
        method: 'POST',
        body: body.toString(),
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        }
    })
    .then((res) => res.json())
    .then((res) => {
        let updated = {...data, ...res};
        localStorage?.setItem?.('hassTokens', JSON.stringify(updated));
        tokenObj = updated; // update tokenObj
        return updated;
    })
}

const refreshAppToken = () => {
    let hassConnection = window.hassConnection || window.parent.hassConnection;
    if(hassConnection) {
        return hassConnection.then((config) => {
            return config?.auth?.refreshAccessToken?.() || null;
        })
        .then(() => {
            return getTokenFromHassConnection();
        })
        .catch((err) => {
            console.log(`error getting access token from HASS Connection: ${err}`);
            return {};
        })
    }
    return {};
}

const refreshToken = (data) => {
    if(isRefreshing) {
        return isRefreshing;
    }
    if (data.refresh_token) {
        isRefreshing = refreshWebToken(data);
    } else {
        isRefreshing = refreshAppToken();
    }
    return isRefreshing.finally(() => {
        isRefreshing = null;
    });
};

const getToken = () => {
    if (tokenObj) {
        return Promise.resolve(tokenObj);
    }
    let storage = localStorage?.getItem?.('hassTokens');
    if (!storage) {
        return getTokenFromHassConnection();
    }
    let data;
    try {
        data = JSON.parse(storage);
        tokenObj = {...data};
    } catch(e) {
        data = {};
    }
    return Promise.resolve(data);
}

export const getAccessToken = () => {
    return getToken()
    .then((data) => {
        if(data.expires) {
            let expiresIn = data.expires - new Date().getTime();
            if (expiresIn > 10000) { // not yet expired
                if (expiresIn < 60000) { // almost expired. refresh it passively
                    refreshToken(data);
                }
            } else { // expired. await refreshed token
                return refreshToken(data).then(() => getToken());
            }
            return data;
        }
        return {};
    })
    .then((data) => {
        let token = data.access_token || '';
        return token;
    });
}