// @flow

import type {Route} from "react-router";
import {matchPattern} from "react-router/lib/PatternUtils";

export type RouteName = "dashboard" | "def" | "defInfo" | "defRefs" | "repo" | "tree" | "blob" | "build" | "builds" | "login" | "signup" | "forgot" | "reset" | "admin" | "adminBuilds";

export const rel: {[key: RouteName]: string} = {
	dashboard: "",
	login: "login",
	signup: "join",
	forgot: "forgot",
	reset: "reset",
	admin: "-/",
	def: "def/*",
	defInfo: "info",
	defRefs: "refs",
	repo: "*", // matches both "repo" and "repo@rev"
	tree: "tree/*",
	blob: "blob/*",
	build: "builds/:id",
	builds: "builds",
};

export const abs: {[key: RouteName]: string} = {
	dashboard: rel.dashboard,
	login: rel.login,
	signup: rel.signup,
	forgot: rel.forgot,
	reset: rel.reset,
	admin: rel.admin,
	adminBuilds: `${rel.admin}${rel.builds}`,
	def: `${rel.repo}/-/${rel.def}`,
	defInfo: `${rel.repo}/-/${rel.def}/-/info`,
	defRefs: `${rel.repo}/-/${rel.def}/-/refs`,
	repo: rel.repo,
	tree: `${rel.repo}/-/${rel.tree}`,
	blob: `${rel.repo}/-/${rel.blob}`,
	build: `${rel.repo}/-/${rel.build}`,
	builds: `${rel.repo}/-/${rel.builds}`,
};

const routeNamesByPattern: {[key: string]: RouteName} = {};
// $FlowHack
for (let name: RouteName of Object.keys(abs)) {
	routeNamesByPattern[abs[name]] = name;
}

export function getRoutePattern(routes: Array<Route>): string {
	return routes.map((route) => route.path).join("").slice(1); // remove leading '/''
}

export function getRouteName(routes: Array<Route>): ?string {
	return routeNamesByPattern[getRoutePattern(routes)];
}

export function getViewName(routes: Array<Route>): ?string {
	let name = getRouteName(routes);
	if (name) {
		return `View${name.charAt(0).toUpperCase()}${name.slice(1)}`;
	}
	return null;
}

export function getRouteParams(pattern: string, pathname: string): ?{[key: string]: string | string[]} {
	const {paramNames, paramValues} = matchPattern(pattern, pathname);

	if (paramValues !== null) {
		return paramNames.reduce((memo, paramName, index) => {
			if (typeof memo[paramName] === "undefined") {
				memo[paramName] = paramValues[index];
			} else if (typeof memo[paramName] === "string") {
				memo[paramName] = [memo[paramName], paramValues[index]];
			} else {
				memo[paramName].push(paramValues[index]);
			}
			return memo;
		}, {});
	}

	return null;
}
