#include "bindings/bindings.h"
#import <UIKit/UIKit.h>

extern "C" void galmail_apple_bootstrap(void);

int main(int argc, char * argv[]) {
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
