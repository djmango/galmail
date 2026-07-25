#include "bindings/bindings.h"
#import <UIKit/UIKit.h>

extern "C" void galmail_apple_bootstrap(void);
extern "C" bool galmail_ios_present_oauth(const char *, const char *, const char *);
extern "C" bool galmail_ios_open_oauth_url(const char *);

// Release iOS builds use -fvisibility=hidden, so Rust cannot dlsym Swift @_cdecl
// symbols. Store the presenter here (same TU as main) and expose a trampoline
// Rust calls via a normal linker-resolved extern.
using galmail_ios_present_fn = bool (*)(const char *, const char *, const char *);
static galmail_ios_present_fn g_galmail_ios_present = nullptr;

extern "C" __attribute__((used, visibility("default"))) void
galmail_ios_register_oauth_presenter(galmail_ios_present_fn present) {
	g_galmail_ios_present = present;
}

extern "C" __attribute__((used, visibility("default"))) bool
galmail_ios_invoke_oauth_presenter(
	const char *url,
	const char *callback_scheme,
	const char *attempt_id
) {
	if (g_galmail_ios_present == nullptr) {
		return false;
	}
	return g_galmail_ios_present(url, callback_scheme, attempt_id);
}

int main(int argc, char * argv[]) {
	// Keep Swift OAuth cdecls from Release dead-code stripping.
	volatile void *oauthRetain[] = {
		(void *)&galmail_ios_present_oauth,
		(void *)&galmail_ios_open_oauth_url,
		(void *)&galmail_ios_register_oauth_presenter,
		(void *)&galmail_ios_invoke_oauth_presenter,
	};
	(void)oauthRetain;

	[[NSNotificationCenter defaultCenter]
		addObserverForName:UIApplicationDidFinishLaunchingNotification
		object:nil
		queue:[NSOperationQueue mainQueue]
		usingBlock:^(__unused NSNotification *notification) {
			galmail_apple_bootstrap();
		}];
	ffi::start_app();
	return 0;
}
