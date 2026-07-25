#include "bindings/bindings.h"
#import <UIKit/UIKit.h>

extern "C" void galmail_apple_bootstrap(void);
// Swift @_cdecl entry points. Rust resolves these via dlsym(RTLD_DEFAULT).
// Taking their addresses here keeps Release dead-code stripping from removing
// them — without this, OAuth fails with "presenter is unavailable in this build".
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
