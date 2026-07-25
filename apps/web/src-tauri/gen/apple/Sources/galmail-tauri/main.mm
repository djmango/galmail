#include "bindings/bindings.h"
#import <UIKit/UIKit.h>

extern "C" void galmail_apple_bootstrap(void);
// Keep Swift OAuth cdecls from Release dead-code stripping. Bootstrap registers
// the presenter function pointer into Rust (dlsym cannot see hidden-visibility
// Swift @_cdecl symbols under -fvisibility=hidden).
extern "C" bool galmail_ios_present_oauth(const char *, const char *, const char *);
extern "C" bool galmail_ios_open_oauth_url(const char *);

int main(int argc, char * argv[]) {
	volatile void *oauthRetain[] = {
		(void *)&galmail_ios_present_oauth,
		(void *)&galmail_ios_open_oauth_url,
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
